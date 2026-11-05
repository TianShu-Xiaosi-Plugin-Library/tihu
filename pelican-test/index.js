/**
 * pelican-test — 鹈鹕测试。
 *
 * 一个沙箱 = 一个天枢会话 + 一个独立工作区 + 一份 meta（72 小时后到期）。
 * 「新建会话」走宿主本地 HTTP API（POST /sessions），这是桌面端前端自己用的同一条通道；
 * 「归档」走 DELETE /sessions/{id}（宿主实现即归档），再把沙箱目录移进 archive/。
 *
 * 隔离边界（实测，不是推测）：会话 cwd 决定它的 .rivet 项目记忆位置；
 * 全局长记忆插件（xiaosi-axiom）的库按用户存放、检索不带 project 过滤，
 * 因此跨会话的记忆共享无法由本插件阻断——见 README「边界」。
 */
import { defineTianshuPlugin } from './tpi.js'
import {
  RETENTION_MS,
  archiveSandbox,
  attachSession,
  createSandbox,
  expiredSandboxes,
  listSandboxes,
  readMeta,
} from './lib/sandbox.js'
import { archiveSession, createSession, readServerInfo } from './lib/host-api.js'
import { dirname, join } from 'node:path'
import { DOMAINS, domainLabel, domainWarning, resolveDomain } from './lib/domains.js'
import { buildSandboxPrompt, isPelicanTestRequest, remainingText, sandboxIdForCwd } from './lib/prompt.js'

export default defineTianshuPlugin({
  id: 'pelican-test',
  activate(host) {
    /** server-info.json 在 .rivet 根；dataDir 可能是根、也可能是 plugin-data/<id>，统一向上定位。 */
    const rivetRoot = dirname(readServerInfo(host.storage.dataDir()).file)
    /** 沙箱库与 bin/pelican-open.mjs 共用同一位置，两边必须一致。 */
    const storeDir = join(rivetRoot, 'plugin-data', 'pelican-test')

    /** 每次现读：宿主重启会换端口与 token，缓存会失效。 */
    const server = () => readServerInfo(rivetRoot)

    /** 当前会话是不是鶈鹕沙箱：cwd 落在沙箱目录下就是。一次算清，之后每轮直接用。 */
    const activeSandboxId = sandboxIdForCwd(host.cwd, storeDir)

    async function archiveOne(meta) {
      if (meta.sessionId) await archiveSession(server(), meta.sessionId)
      return archiveSandbox(storeDir, meta.id)
    }

    return {
      tools: [
        {
          name: 'pelican_open',
          description:
            '开一个临时沙箱会话：独立工作区，不碰当前项目，72 小时后自动归档。想随手试点什么又不想弄脏真实项目时用它。用户说「开个沙箱」「随便试试」「开始测试」时调用。',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '沙箱标题，省略则按时间生成' },
              domain: {
                type: 'string',
                description: `星域，填 id 或中文名都行。常用：${DOMAINS.map(d => d.name).join('、')}；填别的也会照建，宿主不认识时会告诉你`,
              },
              model: {
                type: 'string',
                description: '模型名（如 deepseek-flash）。省略则用宿主默认。宿主不校验模型名，拼错会在首轮报错',
              },
            },
          },
          async execute(call) {
            const domain = resolveDomain(call.args.domain)
            const meta = createSandbox(storeDir, { title: call.args.title, domain, model: call.args.model })
            try {
              const session = await createSession(server(), {
                cwd: meta.workspace,
                title: meta.title,
                domain,
                model: call.args.model,
              })
              const withSession = attachSession(storeDir, meta.id, {
                sessionId: session.id,
                domain: session.domain,
                model: session.model,
                glyph: session.domainGlyph,
              })
              const lines = [
                `沙箱已开：${withSession.id}`,
                `会话：${session.id}（已在桌面端出现）`,
                `星域：${domainLabel(withSession.domain)}　模型：${withSession.model ?? '（宿主默认）'}`,
                `工作区：${withSession.workspace}`,
                `到期：${new Date(withSession.expiresAt).toLocaleString()}（约 72 小时）`,
              ]
              const warn = domainWarning(withSession.domain, session.domainGlyph)
              if (warn) lines.push(`注意：${warn}`)
              return { content: lines.join('\n') }
            } catch (err) {
              const archived = archiveSandbox(storeDir, meta.id)
              return {
                content: `建会话失败，已回滚沙箱 ${archived.id}：${err.message}`,
                isError: true,
              }
            }
          },
        },
        {
          name: 'pelican_status',
          description: '列出鹈鹕测试沙箱：会话 id、工作区、剩余时间。用户问「鹈鹕测试还有几个/什么时候归档」时调用。',
          inputSchema: { type: 'object', properties: {} },
          concurrencySafe: true,
          async execute() {
            const items = listSandboxes(storeDir)
            if (items.length === 0) return { content: '当前没有活跃的鹈鹕沙箱。用 pelican_open 开一个。' }
            return {
              content: items
                .map(m => `${m.id}｜会话 ${m.sessionId ?? '（未绑定）'}｜${domainLabel(m.domain)}·${m.model ?? '默认模型'}｜剩余 ${remainingText(m)}｜${m.workspace}`)
                .join('\n'),
            }
          },
        },
        {
          name: 'pelican_archive',
          description: '立刻归档一个鹈鹕沙箱（不等 72 小时）：归档宿主会话并把工作区移入 archive/。',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: '沙箱 id，见 pelican_status' } },
            required: ['id'],
          },
          requiresApproval: true,
          async execute(call) {
            const meta = listSandboxes(storeDir).find(m => m.id === call.args.id)
            if (!meta) return { content: `没有这个沙箱：${call.args.id}`, isError: true }
            const archived = await archiveOne(meta)
            if (archived.status === 'pending-archive') {
              return {
                content: `会话已归档，但工作区被占用（可能有进程正持有它），已标记待重试：${archived.id}。下一轮会自动再试一次。`,
              }
            }
            return { content: `已归档 ${archived.id}（会话 ${archived.sessionId ?? '无'}，归档时间 ${new Date(archived.archivedAt).toLocaleString()}）` }
          },
        },
      ],
      lifecycle: {
        /** 每轮：先把到期的沙箱归档，再给沙箱会话注入内置提示词。 */
        async turnStart(event) {
          const due = expiredSandboxes(storeDir)
          for (const meta of due) {
            try {
              const result = await archiveOne(meta)
              if (result.status === 'archived') host.log.info(`pelican: 已归档 ${meta.id}`)
              else host.log.info(`pelican: ${meta.id} 工作区被占用，下轮再试`)
            } catch (err) {
              host.log.warn(`pelican: 归档 ${meta.id} 失败：${err.message}`)
            }
          }

          if (!activeSandboxId) return
          const meta = readMeta(storeDir, activeSandboxId)
          const pelicanTest = isPelicanTestRequest(event?.userInput)
          host.promptContext?.setBlock(meta ? buildSandboxPrompt(meta, Date.now(), { pelicanTest }) : null)
        },
      },
    }
  },
})

export { RETENTION_MS }
