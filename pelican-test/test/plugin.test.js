import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

globalThis.__tianshuTPI = { defineTianshuPlugin: spec => spec }
const plugin = (await import('../index.js')).default
const { createSandbox, RETENTION_MS } = await import('../lib/sandbox.js')
const { DOMAINS, FALLBACK_GLYPH } = await import('../lib/domains.js')

/** 假天枢宿主：记录收到的请求，返回预置回执。 */
async function fakeHost() {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : undefined })
      if (req.method === 'POST' && req.url === '/sessions') {
        const req0 = JSON.parse(body)
        // 模拟宿主：认得的星域给专属图标，不认的落兜底齿轮；没指定就给默认星域
        const known = req0.domain ? DOMAINS.some(d => d.id === req0.domain) : true
        res.writeHead(201, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({
            id: 'session-new',
            cwd: req0.cwd,
            domain: req0.domain ?? 'qiming',
            domainGlyph: known ? (req0.domain ? '↻' : '☥') : FALLBACK_GLYPH,
            model: req0.model ?? 'deepseek-flash',
          }))
        return
      }
      if (req.method === 'DELETE') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"archived":true}')
        return
      }
      res.writeHead(404).end('{}')
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return { seen, port: server.address().port, close: () => new Promise(r => server.close(r)) }
}

/** 造一个 rivet 根：server-info.json + 假 host 对象。 */
function makeEnv(port) {
  const rivetRoot = mkdtempSync(join(tmpdir(), 'pelican-plugin-'))
  writeFileSync(join(rivetRoot, 'server-info.json'),
    JSON.stringify({ port, host: '127.0.0.1', token: 'test-token' }))
  const storeDir = join(rivetRoot, 'plugin-data', 'pelican-test')
  mkdirSync(storeDir, { recursive: true })
  const logs = []
  const host = {
    storage: { dataDir: () => storeDir },
    log: { info: m => logs.push(m), warn: m => logs.push(m) },
  }
  return { rivetRoot, storeDir, host, logs }
}

test('manifest 声明的工具与 activate 产出一致', () => {
  const manifest = JSON.parse(readFileSync(new URL('../tianshu.plugin.json', import.meta.url), 'utf8'))
  const { host } = makeEnv(1)
  const out = plugin.activate(host)

  assert.equal(manifest.id, plugin.id)
  assert.equal(manifest.entry, 'index.js')
  assert.deepEqual(manifest.contributes.tools.map(t => t.name), out.tools.map(t => t.name))
  assert.deepEqual(manifest.contributes.lifecycle, ['turnStart'])
  assert.equal(typeof out.lifecycle.turnStart, 'function')

  // 宿主只认这 8 个 capability —— 2026-11-05 实测：把 "lifecycle" 写进去会让清单整体失效。
  const LEGAL = ['tools', 'storage', 'account', 'embeddings', 'sidePathLLM', 'promptContext', 'transcripts', 'log']
  for (const cap of manifest.capabilities) {
    assert.ok(LEGAL.includes(cap), `非法 capability: ${cap}`)
  }
})

test('pelican_open 建沙箱并以沙箱工作区为 cwd 调 POST /sessions', async () => {
  const fake = await fakeHost()
  const { storeDir, host } = makeEnv(fake.port)
  try {
    const tool = plugin.activate(host).tools.find(t => t.name === 'pelican_open')
    const result = await tool.execute({ args: { title: '鹈鹕一键' } })

    assert.match(result.content, /session-new/)
    assert.equal(fake.seen.length, 1)
    assert.equal(fake.seen[0].method, 'POST')
    assert.equal(fake.seen[0].path, '/sessions')

    const sentCwd = fake.seen[0].body.cwd
    assert.ok(sentCwd.endsWith('workspace'), 'cwd 必须指向沙箱 workspace')
    assert.equal(existsSync(sentCwd), true, '沙箱目录必须真的建好')

    // 会话 id 回填进 meta，供之后归档用
    const meta = (await import('../lib/sandbox.js')).listSandboxes(storeDir)[0]
    assert.equal(meta.sessionId, 'session-new')
  } finally { await fake.close() }
})

test('pelican_open 把中文星域名翻成 id 发出，meta 记宿主回执的实际值', async () => {
  const fake = await fakeHost()
  const { storeDir, host } = makeEnv(fake.port)
  try {
    const tool = plugin.activate(host).tools.find(t => t.name === 'pelican_open')
    const result = await tool.execute({ args: { title: '瑶光跑一遍', domain: '瑶光', model: 'glm:glm-5.3-flash' } })

    assert.equal(fake.seen[0].body.domain, 'yaoguang', '发出去的必须是星域 id')
    assert.equal(fake.seen[0].body.model, 'glm:glm-5.3-flash')
    const meta = (await import('../lib/sandbox.js')).listSandboxes(storeDir)[0]
    assert.equal(meta.domain, 'yaoguang')
    assert.equal(meta.model, 'glm:glm-5.3-flash')
    assert.match(result.content, /瑶光\(↻\)/, '回执要告诉用户用的是哪个星域')
  } finally { await fake.close() }
})

test('未知星域照样建，但会明说宿主没认出来', async () => {
  const fake = await fakeHost()
  const { storeDir, host } = makeEnv(fake.port)
  try {
    const tool = plugin.activate(host).tools.find(t => t.name === 'pelican_open')
    const result = await tool.execute({ args: { domain: 'kaoyang' } })

    assert.equal(result.isError, undefined, '这是通道不是闸门：不认识也要照建')
    assert.equal(fake.seen.length, 1)
    assert.equal(fake.seen[0].body.domain, 'kaoyang', '用户填什么就发什么')
    assert.match(result.content, /不认识星域「kaoyang」/)
    const meta = (await import('../lib/sandbox.js')).listSandboxes(storeDir)[0]
    assert.equal(meta.domainGlyph, FALLBACK_GLYPH, 'meta 要记下宿主给的兜底图标')
  } finally { await fake.close() }
})

test('pelican_open 不指定星域时交给宿主默认，并如实记录回执值', async () => {
  const fake = await fakeHost()
  const { storeDir, host } = makeEnv(fake.port)
  try {
    const tool = plugin.activate(host).tools.find(t => t.name === 'pelican_open')
    await tool.execute({ args: {} })

    assert.equal('domain' in fake.seen[0].body, false, '没指定就不该往 body 里塞 domain')
    const meta = (await import('../lib/sandbox.js')).listSandboxes(storeDir)[0]
    assert.equal(meta.domain, 'qiming', 'meta 记的是宿主回执，不是请求值')
  } finally { await fake.close() }
})

test('turnStart 把到期的沙箱连同宿主会话一起归档', async () => {
  const fake = await fakeHost()
  const { storeDir, host, logs } = makeEnv(fake.port)
  try {
    const stale = createSandbox(storeDir, { now: Date.now() - RETENTION_MS - 1000 })
    await import('../lib/sandbox.js').then(m => m.attachSession(storeDir, stale.id, { sessionId: 'session-stale' }))

    const out = plugin.activate(host)
    await out.lifecycle.turnStart({})

    assert.equal(fake.seen.some(r => r.method === 'DELETE' && r.path === '/sessions/session-stale'), true,
      '必须先归档宿主会话')
    assert.equal(existsSync(join(storeDir, 'pelican', 'sessions', stale.id)), false, '沙箱目录应移走')
    assert.equal(existsSync(join(storeDir, 'pelican', 'archive', stale.id)), true)
    assert.ok(logs.some(l => l.includes('到期归档')), '归档要留日志')
  } finally { await fake.close() }
})

test('未到期的沙箱在 turnStart 里原封不动', async () => {
  const fake = await fakeHost()
  const { storeDir, host } = makeEnv(fake.port)
  try {
    const fresh = createSandbox(storeDir, {})
    await plugin.activate(host).lifecycle.turnStart({})
    assert.equal(fake.seen.length, 0, '不该产生任何宿主调用')
    assert.equal(existsSync(join(storeDir, 'pelican', 'sessions', fresh.id)), true)
  } finally { await fake.close() }
})

test('pelican_archive 拒绝不存在的沙箱 id', async () => {
  const { host } = makeEnv(1)
  const tool = plugin.activate(host).tools.find(t => t.name === 'pelican_archive')
  const result = await tool.execute({ args: { id: 'nope' } })
  assert.equal(result.isError, true)
  assert.match(result.content, /没有这个沙箱/)
})
