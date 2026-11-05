/**
 * 复核星域表：逐个候选 id 建会话，读回执里的 domainGlyph，立刻归档。
 * 有专属图标的才是真星域；落 ⚙ 的不是——宿主对 domain 不做校验，光看 201 分不出来。
 *
 * 用法：node bin/probe-domains.mjs [--root=<天枢 .rivet 根>]
 */
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { findServerInfo, readServerInfo } from '../lib/host-api.js'
import { DOMAINS, FALLBACK_GLYPH } from '../lib/domains.js'

const rootArg = process.argv.slice(2).find(a => a.startsWith('--root='))
const root = rootArg ? rootArg.slice(7) : process.env.TIANSHU_RIVET_ROOT
if (!root) {
  console.error('缺少 --root=<天枢 .rivet 根>（或用环境变量 TIANSHU_RIVET_ROOT）')
  process.exit(2)
}
const infoFile = findServerInfo(root)
if (!infoFile) {
  console.error(`没找到 server-info.json（起点 ${root}）`)
  process.exit(2)
}

const server = readServerInfo(dirname(infoFile))
const candidates = [...DOMAINS.map(d => d.id), 'tanlang', 'not_a_domain']
// 探针会话的 cwd 放临时目录：别把会话堆进天枢自己的数据目录。
const probeCwd = join(tmpdir(), 'pelican-probe')
mkdirSync(probeCwd, { recursive: true })

for (const domain of candidates) {
  const res = await fetch(server.base + '/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: probeCwd, domain }),
  })
  const s = await res.json()
  const ok = s.domainGlyph && s.domainGlyph !== FALLBACK_GLYPH
  console.log(`${domain.padEnd(12)} ${ok ? '✓' : '✗'} glyph=${s.domainGlyph} accent=${s.domainAccent}`)
  await fetch(server.base + '/sessions/' + s.id, { method: 'DELETE', headers: { Authorization: `Bearer ${server.token}` } })
}
