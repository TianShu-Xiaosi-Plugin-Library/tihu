import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RETENTION_MS,
  archiveSandbox,
  attachSession,
  createSandbox,
  expiredSandboxes,
  listSandboxes,
  newSandboxId,
} from '../lib/sandbox.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'pelican-'))

test('createSandbox 建出 workspace 与 meta，过期时间恰好 72 小时', () => {
  const dataDir = tmp()
  const now = 1_800_000_000_000
  const meta = createSandbox(dataDir, { now, title: '鹈鹕用例' })

  assert.equal(existsSync(meta.workspace), true, 'workspace 必须存在')
  assert.ok(meta.workspace.endsWith('workspace'))
  assert.equal(meta.createdAt, now)
  assert.equal(meta.expiresAt, now + RETENTION_MS)
  assert.equal(meta.expiresAt - meta.createdAt, 72 * 60 * 60 * 1000)
  assert.equal(meta.status, 'active')
  assert.equal(meta.title, '鹈鹕用例')

  const onDisk = JSON.parse(readFileSync(join(dataDir, 'pelican', 'sessions', meta.id, 'meta.json'), 'utf8'))
  assert.deepEqual(onDisk, meta)
})

test('newSandboxId 形状：8 位日期 + 12 位小写 hex', () => {
  const id = newSandboxId(new Date('2026-11-05T10:00:00Z').getTime())
  assert.match(id, /^\d{8}[0-9a-f]{12}$/)
})

test('expiredSandboxes 只挑出到期的 active 沙箱', () => {
  const dataDir = tmp()
  const now = 1_800_000_000_000
  const fresh = createSandbox(dataDir, { now })
  const stale = createSandbox(dataDir, { now: now - RETENTION_MS - 1 })

  const expired = expiredSandboxes(dataDir, now)
  assert.deepEqual(expired.map(m => m.id), [stale.id], '只有过期那个算过期')
  assert.equal(expired.some(m => m.id === fresh.id), false)
})

test('archiveSandbox 把目录移进 archive/ 并标记 archived', () => {
  const dataDir = tmp()
  const now = 1_800_000_000_000
  const meta = createSandbox(dataDir, { now })

  const archived = archiveSandbox(dataDir, meta.id, { now: now + 1000 })

  assert.equal(archived.status, 'archived')
  assert.equal(archived.archivedAt, now + 1000)
  assert.equal(existsSync(join(dataDir, 'pelican', 'sessions', meta.id)), false, '原目录应已移走')
  assert.equal(existsSync(join(dataDir, 'pelican', 'archive', meta.id, 'workspace')), true, '归档后 workspace 仍在')
  assert.deepEqual(listSandboxes(dataDir), [], '归档后不再出现在活跃列表')
})

test('attachSession 回填宿主回执的 sessionId / domain / model', () => {
  const dataDir = tmp()
  const meta = createSandbox(dataDir, { now: 1_800_000_000_000 })
  const next = attachSession(dataDir, meta.id, { sessionId: '2026110591bff0d6b60c', domain: 'yaoguang', model: 'glm:glm-5.3-flash' })
  assert.equal(next.sessionId, '2026110591bff0d6b60c')
  assert.equal(next.domain, 'yaoguang')
  assert.equal(next.model, 'glm:glm-5.3-flash')
  const onDisk = listSandboxes(dataDir)[0]
  assert.equal(onDisk.sessionId, '2026110591bff0d6b60c')
  assert.equal(onDisk.domain, 'yaoguang')
})

test('createSandbox 把请求的星域/模型写进 meta，缺省为 null', () => {
  const dataDir = tmp()
  const withDomain = createSandbox(dataDir, { now: 1_800_000_000_000, domain: 'pojun', model: 'deepseek-flash' })
  assert.equal(withDomain.domain, 'pojun')
  assert.equal(withDomain.model, 'deepseek-flash')

  const bare = createSandbox(dataDir, { now: 1_800_000_001_000 })
  assert.equal(bare.domain, null)
  assert.equal(bare.model, null)
})

test('listSandboxes 按创建时间倒序，空目录返回空数组', () => {
  const dataDir = tmp()
  assert.deepEqual(listSandboxes(dataDir), [])
  const a = createSandbox(dataDir, { now: 1_800_000_000_000 })
  const b = createSandbox(dataDir, { now: 1_800_000_001_000 })
  assert.deepEqual(listSandboxes(dataDir).map(m => m.id), [b.id, a.id])
})

test('工作区被占用时只标 pending-archive，不谎称已归档', async () => {
  const { spawn } = await import('node:child_process')
  const dataDir = tmp()
  const now = 1_800_000_000_000
  const meta = createSandbox(dataDir, { now })

  // 真造占用：子进程把 cwd 停在 workspace 里，父目录就搬不动了
  const child = spawn(process.execPath, ['-e', `process.chdir(${JSON.stringify(meta.workspace)}); setInterval(()=>{}, 1000)`], { stdio: 'ignore' })
  try {
    await new Promise(r => setTimeout(r, 500))
    const result = archiveSandbox(dataDir, meta.id, { now: now + 1000 })

    assert.equal(result.status, 'pending-archive', '搬不动就不能报已归档')
    assert.equal(result.archivedAt, null)
    assert.equal(result.lastArchiveAttemptAt, now + 1000)
    assert.equal(existsSync(join(dataDir, 'pelican', 'sessions', meta.id)), true, '目录还在原地')
    assert.equal(existsSync(join(dataDir, 'pelican', 'archive', meta.id)), false)
  } finally {
    child.kill()
  }
})

test('pending 的沙箱会被再次挑出来重试，占用解除后转 archived', async () => {
  const { spawn } = await import('node:child_process')
  const dataDir = tmp()
  const now = 1_800_000_000_000
  const meta = createSandbox(dataDir, { now })

  const child = spawn(process.execPath, ['-e', `process.chdir(${JSON.stringify(meta.workspace)}); setInterval(()=>{}, 1000)`], { stdio: 'ignore' })
  await new Promise(r => setTimeout(r, 500))
  archiveSandbox(dataDir, meta.id, { now: now + 1000 })
  child.kill()
  await new Promise(r => setTimeout(r, 700))

  assert.deepEqual(expiredSandboxes(dataDir, now).map(m => m.id), [meta.id], 'pending 的必须进重试名单')

  const retried = archiveSandbox(dataDir, meta.id, { now: now + 2000 })
  assert.equal(retried.status, 'archived')
  assert.equal(retried.archivedAt, now + 2000)
  assert.equal(existsSync(join(dataDir, 'pelican', 'archive', meta.id, 'meta.json')), true)
})

test('isBusyError 只认 EPERM / EBUSY', async () => {
  const { isBusyError } = await import('../lib/sandbox.js')
  assert.equal(isBusyError({ code: 'EPERM' }), true)
  assert.equal(isBusyError({ code: 'EBUSY' }), true)
  assert.equal(isBusyError({ code: 'ENOENT' }), false)
  assert.equal(isBusyError(null), false)
})
