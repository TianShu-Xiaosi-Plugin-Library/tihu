/**
 * 宿主本地 HTTP API 的最薄封装。
 *
 * 已验证事实（不是推测）：
 *   - server-info.json 含 { port, host, token }，位于 <rivetRoot>/server-info.json
 *   - GET  /sessions          → 200 {"sessions":[...]}
 *   - POST /sessions          → 201 会话对象（body 可带 cwd / title）
 *   - DEL  /sessions/{id}     → 200 {"archived":true}  —— 宿主的「删除」即归档
 * 鉴权：Authorization: Bearer <token>
 *
 * 本模块只做 HTTP，不碰插件宿主对象，便于脱离天枢单测。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 从 startDir 起向上最多 maxUp 级查找 server-info.json。找不到返回 null。 */
export function findServerInfo(startDir, maxUp = 4) {
  let dir = resolve(startDir)
  for (let i = 0; i <= maxUp; i += 1) {
    const file = join(dir, 'server-info.json')
    if (existsSync(file)) return file
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 读 server-info.json → { base, token }。文件缺失直接抛错，不静默降级。 */
export function readServerInfo(startDir) {
  const file = findServerInfo(startDir)
  if (!file) throw new Error(`server-info.json 未找到（起点 ${startDir}）——天枢桌面端是否在运行？`)
  const info = JSON.parse(readFileSync(file, 'utf8'))
  if (!info.port || !info.token) throw new Error(`server-info.json 缺 port 或 token：${file}`)
  return { base: `http://${info.host ?? '127.0.0.1'}:${info.port}`, token: info.token, file }
}

async function call(server, method, path, body) {
  const res = await fetch(server.base + path, {
    method,
    headers: {
      Authorization: `Bearer ${server.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/**
 * 建会话。cwd 是隔离的关键：不同 cwd = 不同 .rivet 项目记忆。
 * domain / model 宿主都不校验——非法值照收，domain 会静默退化成兜底人格，
 * 所以 domain 必须先在 lib/domains.js 那里过一遍白名单。
 */
export function createSession(server, { cwd, title, domain, model }) {
  const body = {}
  if (cwd) body.cwd = cwd
  if (title) body.title = title
  if (domain) body.domain = domain
  if (model) body.model = model
  return call(server, 'POST', '/sessions', body)
}

export function listSessions(server) {
  return call(server, 'GET', '/sessions')
}

/**
 * 宿主把「删除会话」实现为归档，返回 { archived: true }。
 * 已经归档过的会话回 404 "Session not found or already archived"——
 * 那是幂等成功，不是错误（重复归档不该让调用方炸掉）。
 */
export async function archiveSession(server, id) {
  try {
    return await call(server, 'DELETE', `/sessions/${encodeURIComponent(id)}`)
  } catch (err) {
    if (String(err.message).includes('already archived')) {
      return { archived: true, alreadyArchived: true }
    }
    throw err
  }
}
