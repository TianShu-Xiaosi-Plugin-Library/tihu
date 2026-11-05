/**
 * 沙箱里的内置提示词：让用户不用每次交代「这是临时环境，随便试」。
 *
 * 判据是物理事实——会话的 cwd 落在沙箱目录下，就说明这是一个鹈鹕沙箱会话。
 * 不在沙箱里的会话什么都不注入。
 */
import { isAbsolute, join, relative } from 'node:path'
import { domainLabel } from './domains.js'

const HOUR = 60 * 60 * 1000

/** 剩余时间的人话表述。 */
export function remainingText(meta, now = Date.now()) {
  const ms = meta.expiresAt - now
  if (ms <= 0) return '已到期'
  const h = Math.floor(ms / HOUR)
  const m = Math.round((ms % HOUR) / 60000)
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

/** cwd 落在 <storeDir>/pelican/sessions/<id>/… 下就返回那个 id，否则 null。 */
export function sandboxIdForCwd(cwd, storeDir) {
  if (!cwd) return null
  const sessionsDir = join(storeDir, 'pelican', 'sessions')
  const rel = relative(sessionsDir, cwd)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  const [id] = rel.split(/[\\/]/)
  return id || null
}

/** 注入给沙箱会话的提示块。每轮重新生成，剩余时间才是当前的。 */
export function buildSandboxPrompt(meta, now = Date.now()) {
  return [
    '## 鹈鹕沙箱',
    '',
    '你在一个临时沙箱里工作，不是用户的真实项目。',
    '',
    `- 工作区：${meta.workspace}`,
    `- 到期：${new Date(meta.expiresAt).toLocaleString()}（还剩 ${remainingText(meta, now)}）`,
    `- 星域：${domainLabel(meta.domain)}　模型：${meta.model ?? '宿主默认'}`,
    '',
    '可以随便试：改坏、删光、重写，都不影响用户的项目。到期后这个会话会自动归档，',
    '工作区移进 archive/。想提前结束就说一声（pelican_archive）。',
    '想在别的星域或模型上再跑一遍，用 pelican_open 开一个新的沙箱。',
    '',
    '结果必须来自真实执行：没跑过的测试不要说跑过了，跑挂了就把报错原样贴出来，',
    '不要替用户总结成「测试通过」。用户要的是这次真跑出来的东西。',
  ].join('\n')
}
