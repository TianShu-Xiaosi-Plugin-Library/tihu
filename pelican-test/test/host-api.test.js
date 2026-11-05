import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveSession,
  createSession,
  findServerInfo,
  listSessions,
  readServerInfo,
} from '../lib/host-api.js'

/** 起一个假宿主，记录收到的请求，按 record.method+path 查回执。 */
async function fakeHost(replies) {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const auth = req.headers.authorization
      if (auth !== 'Bearer test-token') {
        res.writeHead(401).end('{"error":"unauthorized"}')
        return
      }
      seen.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : undefined })
      const reply = replies[`${req.method} ${req.url}`] ?? { status: 404, body: {} }
      res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return { seen, base: `http://127.0.0.1:${port}`, token: 'test-token', close: () => new Promise(r => server.close(r)) }
}

test('findServerInfo 从深层目录向上找到 server-info.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'pelican-host-'))
  const deep = join(root, 'desktop', 'nested', 'deeper')
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(root, 'server-info.json'), JSON.stringify({ port: 1234, host: '127.0.0.1', token: 't' }))

  assert.equal(findServerInfo(deep), join(root, 'server-info.json'))
  assert.equal(findServerInfo(mkdtempSync(join(tmpdir(), 'pelican-none-'))), null)
})

test('readServerInfo 拼出 base，缺文件直接抛错', () => {
  const root = mkdtempSync(join(tmpdir(), 'pelican-host-'))
  writeFileSync(join(root, 'server-info.json'), JSON.stringify({ port: 59482, host: '127.0.0.1', token: 'abc' }))
  assert.equal(readServerInfo(root).base, 'http://127.0.0.1:59482')

  const empty = mkdtempSync(join(tmpdir(), 'pelican-empty-'))
  assert.throws(() => readServerInfo(empty), /server-info\.json 未找到/)
})

test('createSession 发出带 cwd 的 POST /sessions 并回读会话对象', async () => {
  const host = await fakeHost({ 'POST /sessions': { status: 201, body: { id: 's1', cwd: 'D:\\x' } } })
  try {
    const created = await createSession(host, { cwd: 'D:\\pelican\\ws', title: '鹈鹕测试' })
    assert.equal(created.id, 's1')
    assert.deepEqual(host.seen, [{ method: 'POST', path: '/sessions', body: { cwd: 'D:\\pelican\\ws', title: '鹈鹕测试' } }])
  } finally { await host.close() }
})

test('archiveSession 用 DELETE，宿主回 archived', async () => {
  const host = await fakeHost({ 'DELETE /sessions/s1': { status: 200, body: { archived: true } } })
  try {
    assert.deepEqual(await archiveSession(host, 's1'), { archived: true })
    assert.equal(host.seen[0].method, 'DELETE')
    assert.equal(host.seen[0].path, '/sessions/s1')
  } finally { await host.close() }
})

test('listSessions 解出 sessions 数组', async () => {
  const host = await fakeHost({ 'GET /sessions': { status: 200, body: { sessions: [{ id: 'a' }, { id: 'b' }] } } })
  try {
    assert.deepEqual((await listSessions(host)).sessions.map(s => s.id), ['a', 'b'])
  } finally { await host.close() }
})

test('非 2xx 抛出带状态码的错误，不静默吞掉', async () => {
  const host = await fakeHost({})
  try {
    await assert.rejects(() => createSession(host, { cwd: 'D:\\x' }), /POST \/sessions → 404/)
  } finally { await host.close() }
})
