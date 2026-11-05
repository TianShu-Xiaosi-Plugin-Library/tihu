import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

globalThis.__tianshuTPI = { defineTianshuPlugin: spec => spec }
const plugin = (await import('../index.js')).default
const { createSandbox, RETENTION_MS } = await import('../lib/sandbox.js')
const { buildSandboxPrompt, remainingText, sandboxIdForCwd } = await import('../lib/prompt.js')

/** 造一个 rivet 根 + storeDir；host.cwd 由调用方指定。 */
function makeEnv(cwd) {
  const rivetRoot = mkdtempSync(join(tmpdir(), 'pelican-prompt-'))
  const storeDir = join(rivetRoot, 'plugin-data', 'pelican-test')
  mkdirSync(storeDir, { recursive: true })
  writeFileSync(join(rivetRoot, 'server-info.json'),
    JSON.stringify({ port: 1, host: '127.0.0.1', token: 'test-token' }))
  const blocks = []
  const host = {
    cwd,
    storage: { dataDir: () => storeDir },
    log: { info() {}, warn() {} },
    promptContext: { setBlock: b => blocks.push(b) },
  }
  return { rivetRoot, storeDir, host, blocks }
}

test('sandboxIdForCwd 认得出沙箱 cwd，认不出外面的路径', () => {
  const storeDir = join('D:', 'rivet', 'plugin-data', 'pelican-test')
  const inner = join(storeDir, 'pelican', 'sessions', '20261105abc', 'workspace')

  assert.equal(sandboxIdForCwd(inner, storeDir), '20261105abc')
  assert.equal(sandboxIdForCwd(join(storeDir, 'pelican', 'sessions', '20261105abc'), storeDir), '20261105abc')
  assert.equal(sandboxIdForCwd(join('D:', 'proj', 'src'), storeDir), null, '用户项目目录不该被当成沙箱')
  assert.equal(sandboxIdForCwd(join(storeDir, 'pelican', 'archive', 'x'), storeDir), null, '归档目录不是活跃沙箱')
  assert.equal(sandboxIdForCwd(undefined, storeDir), null)
})

test('remainingText 到点说已到期，没到点给人话剩余', () => {
  const now = 1_800_000_000_000
  assert.equal(remainingText({ expiresAt: now }, now), '已到期')
  assert.equal(remainingText({ expiresAt: now - 1 }, now), '已到期')
  assert.equal(remainingText({ expiresAt: now + 2 * 3600_000 }, now), '2h0m')
  assert.equal(remainingText({ expiresAt: now + 45 * 60_000 }, now), '45m')
})

test('buildSandboxPrompt 把工作区、到期、星域、随便折腾都写进去', () => {
  const now = 1_800_000_000_000
  const meta = {
    workspace: 'D:\\rivet\\pelican\\sessions\\x\\workspace',
    expiresAt: now + RETENTION_MS,
    domain: 'yaoguang',
    model: 'deepseek-flash',
  }
  const text = buildSandboxPrompt(meta, now)

  assert.match(text, /## 鹈鹕沙箱/)
  assert.match(text, /临时沙箱里工作，不是用户的真实项目/, '要先说清这不是真实项目')
  assert.ok(text.includes(meta.workspace), '工作区路径要出现')
  assert.match(text, /还剩 72h0m/)
  assert.match(text, /星域：瑶光\(↻\)/)
  assert.match(text, /deepseek-flash/)
  assert.match(text, /不影响用户的项目/)
  assert.match(text, /自动归档/)
})

test('提示词明确禁止编造结果——结果只能来自真实执行', () => {
  const text = buildSandboxPrompt({ workspace: 'D:/x', expiresAt: 0, domain: null, model: null })
  assert.match(text, /结果必须来自真实执行/)
  assert.match(text, /没跑过的测试不要说跑过了/)
  assert.match(text, /不要替用户总结成「测试通过」/)
})

test('沙箱会话每轮自动注入提示词，剩余时间跟着走', async () => {
  const { storeDir, host, blocks } = makeEnv('placeholder')
  const meta = createSandbox(storeDir, { title: '注入用例', domain: 'pojun' })
  host.cwd = meta.workspace

  const out = plugin.activate(host)
  await out.lifecycle.turnStart({})

  assert.equal(blocks.length, 1, '每轮应当注入一次')
  assert.match(blocks[0], /## 鹈鹕沙箱/)
  assert.ok(blocks[0].includes(meta.workspace))
  assert.match(blocks[0], /星域：破军\(☄\)/)
})

test('非沙箱会话一个字都不注入', async () => {
  const { storeDir, host, blocks } = makeEnv('D:\\some\\real\\project')
  createSandbox(storeDir, { title: '别人的沙箱' })

  const out = plugin.activate(host)
  await out.lifecycle.turnStart({})

  assert.deepEqual(blocks, [], '真实项目会话不该看到沙箱提示')
})

test('沙箱被归档后，下一个轮次把注入块清掉', async () => {
  const { storeDir, host, blocks } = makeEnv('placeholder')
  const meta = createSandbox(storeDir, { title: '会被归档' })
  host.cwd = meta.workspace
  const { archiveSandbox } = await import('../lib/sandbox.js')

  const out = plugin.activate(host)
  await out.lifecycle.turnStart({})
  assert.equal(blocks.length, 1)

  archiveSandbox(storeDir, meta.id)
  await out.lifecycle.turnStart({})
  assert.equal(blocks.length, 2)
  assert.equal(blocks[1], null, '沙箱没了就该清空这块，别留着过期信息')
})
