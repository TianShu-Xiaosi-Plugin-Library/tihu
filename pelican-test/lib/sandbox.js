/**
 * 鹈鹕沙箱的生命周期：分配、列目录、过期判定、归档。
 *
 * 布局（root = <dataDir>/pelican）：
 *   sessions/<id>/meta.json      沙箱元数据
 *   sessions/<id>/workspace/     天枢会话的 cwd —— 隔离就在这里生效
 *   archive/<id>/                过期或手动归档后的去处
 *
 * 只做文件系统，不认识天枢宿主，便于脱离天枢单测。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 72 小时保留期。 */
export const RETENTION_MS = 72 * 60 * 60 * 1000

const HEX = '0123456789abcdef'

/** 与宿主会话 id 同风格：yyyyMMdd + 12 位 hex。 */
export function newSandboxId(now = Date.now()) {
  const d = new Date(now)
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  let tail = ''
  for (let i = 0; i < 12; i += 1) tail += HEX[Math.floor(Math.random() * 16)]
  return stamp + tail
}

export function sandboxRoot(dataDir) {
  return join(dataDir, 'pelican')
}

function sessionsDir(dataDir) {
  return join(sandboxRoot(dataDir), 'sessions')
}

function archiveDir(dataDir) {
  return join(sandboxRoot(dataDir), 'archive')
}

function metaFile(dataDir, id) {
  return join(sessionsDir(dataDir), id, 'meta.json')
}

export function readMeta(dataDir, id) {
  const file = metaFile(dataDir, id)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeMeta(dataDir, meta) {
  writeFileSync(metaFile(dataDir, meta.id), JSON.stringify(meta, null, 2), 'utf8')
}

/** 新建沙箱：建目录与 meta，返回 meta（workspace 为绝对路径）。 */
export function createSandbox(dataDir, { now = Date.now(), title, domain, model } = {}) {
  const id = newSandboxId(now)
  const dir = join(sessionsDir(dataDir), id)
  const workspace = join(dir, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const meta = {
    id,
    title: title ?? `鹈鹕测试 ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`,
    createdAt: now,
    expiresAt: now + RETENTION_MS,
    workspace,
    sessionId: null,
    domain: domain ?? null,
    model: model ?? null,
    status: 'active',
    archivedAt: null,
  }
  writeMeta(dataDir, meta)
  return meta
}

/** 列出所有沙箱 meta（目录不存在时返回空数组）。 */
export function listSandboxes(dataDir) {
  const dir = sessionsDir(dataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => readMeta(dataDir, e.name))
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** 已过期且仍 active 的沙箱。 */
export function expiredSandboxes(dataDir, now = Date.now()) {
  return listSandboxes(dataDir).filter(m => m.status === 'active' && m.expiresAt <= now)
}

/** 把沙箱移入 archive/，meta 标记为 archived 并记录时间。 */
export function archiveSandbox(dataDir, id, { now = Date.now() } = {}) {
  const meta = readMeta(dataDir, id)
  if (!meta) return null
  const next = { ...meta, status: 'archived', archivedAt: now }
  mkdirSync(archiveDir(dataDir), { recursive: true })
  writeMeta(dataDir, next)
  const target = join(archiveDir(dataDir), id)
  if (existsSync(target)) throw new Error(`归档目标已存在：${target}`)
  renameSync(join(sessionsDir(dataDir), id), target)
  return next
}

/**
 * 会话建好后回填宿主回执：sessionId，以及宿主实际采用的 domain / model / glyph
 * （回执值才是事实——请求值可能被宿主改写或落兜底）。
 */
export function attachSession(dataDir, id, { sessionId, domain, model, glyph } = {}) {
  const meta = readMeta(dataDir, id)
  if (!meta) return null
  const next = {
    ...meta,
    sessionId: sessionId ?? meta.sessionId,
    domain: domain ?? meta.domain,
    model: model ?? meta.model,
    domainGlyph: glyph ?? meta.domainGlyph ?? null,
  }
  writeMeta(dataDir, next)
  return next
}
