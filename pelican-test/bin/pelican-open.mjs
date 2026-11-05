/**
 * 鹈鹕测试 · 一键入口。
 *
 * 双击「鹈鹕测试.cmd」→ 建沙箱 → 调宿主 API 建会话（cwd 指向沙箱）→ 打印会话 id。
 * 可以挑星域和模型：不同星域/模型跑出来的结果不一样，所以这两个值会连同沙箱一起记下来。
 * 沙箱库位置与插件保持一致：<rivetRoot>/plugin-data/pelican-test
 *
 * 用法：node bin/pelican-open.mjs --root=<天枢 .rivet 根> [--domain=瑶光|yaoguang] [--model=deepseek-flash] [--title=<标题>]
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findServerInfo, createSession, readServerInfo } from '../lib/host-api.js'
import { archiveSandbox, attachSession, createSandbox } from '../lib/sandbox.js'
import { domainLabel, domainWarning, resolveDomain } from '../lib/domains.js'

function arg(name) {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

// 不给 --root 时，从脚本自身位置向上找 .rivet（部署后 bin → pelican-test → plugins → .rivet）
const here = dirname(fileURLToPath(import.meta.url))
const root = arg('root') ?? process.env.TIANSHU_RIVET_ROOT ?? here

const domain = resolveDomain(arg('domain'))

const infoFile = findServerInfo(root, 6)
if (!infoFile) {
  console.error(`没找到 server-info.json（从 ${here} 向上找了 6 级）`)
  console.error('天枢桌面端需要处于运行状态；也可以用 --root=<天枢 .rivet 根> 指定。')
  process.exit(2)
}

const rivetRoot = dirname(infoFile)
const storeDir = join(rivetRoot, 'plugin-data', 'pelican-test')
const meta = createSandbox(storeDir, { title: arg('title'), domain, model: arg('model') })

try {
  const session = await createSession(readServerInfo(rivetRoot), {
    cwd: meta.workspace,
    title: meta.title,
    domain,
    model: arg('model'),
  })
  const bound = attachSession(storeDir, meta.id, {
    sessionId: session.id,
    domain: session.domain,
    model: session.model,
    glyph: session.domainGlyph,
  })
  console.log('沙箱已开')
  console.log(`  沙箱   ${bound.id}`)
  console.log(`  会话   ${session.id}`)
  console.log(`  星域   ${domainLabel(bound.domain)}`)
  console.log(`  模型   ${bound.model ?? '（宿主默认）'}`)
  console.log(`  工作区 ${bound.workspace}`)
  console.log(`  到期   ${new Date(bound.expiresAt).toLocaleString()}（72 小时后自动归档）`)
  const warn = domainWarning(bound.domain, session.domainGlyph)
  if (warn) console.log(`\n注意：${warn}`)
} catch (err) {
  archiveSandbox(storeDir, meta.id)
  console.error(`建会话失败，沙箱已回滚：${err.message}`)
  process.exit(1)
}
