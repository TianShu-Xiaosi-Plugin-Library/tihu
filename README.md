# tihu — 鹈鹕测试通道

给想随手试点东西的人一个隔离通道：开一个沙箱会话，工作区与真实项目分开，72 小时后自动归档。

天枢（tianshu harness 4.0.1）的 TPI 插件。

## 目标形态

插件激活后，**每个项目的「新建任务」里多一项「新建测试会话」**，并标明「72 小时后自动归档」。

## 当前状态

| 部分 | 状态 |
|---|---|
| 沙箱会话开通（独立工作区 + 建会话） | ✅ 已完成并实测 |
| 72 小时自动归档（惰性扫描 + 手动归档 + 占用重试） | ✅ 已完成并实测 |
| 沙箱内每轮注入环境说明（含「不许编造结果」） | ✅ 已完成；端到端待宿主重启后复验（见「已知问题」） |
| 说一句「鹈鹕测试」→ 自动塞入完整提示词 | ✅ 已完成（单测覆盖）；端到端待宿主重启后复验 |
| 星域 / 模型可选，不设白名单 | ✅ 已完成并实测 |
| **「新建任务」菜单里的入口** | ❌ **需要宿主开放 UI 扩展点** |

最后一项在插件层做不到——TPI 插件没有 UI 菜单注入能力，桌面端前端打包在 `tianshu-desktop.exe` 里。研究结论和宿主侧的已知事实都在 docs/HANDOFF-host-ui-extension.md，接手改宿主扩展点的人从那份文档读起。

## 目录

```
pelican-test/                    插件本体
  tianshu.plugin.json            TPI 清单（capabilities: tools/storage/log/promptContext）
  index.js                       工具与生命周期接线
  lib/host-api.js                宿主本地 HTTP API 封装
  lib/sandbox.js                 沙箱生命周期（分配 / 过期 / 归档）
  lib/domains.js                 星域参考表（不是白名单）
  lib/prompt.js                  沙箱内注入的提示词 + 「鹈鹕测试」触发词
  bin/pelican-open.mjs           一键启动器
  bin/鹈鹕测试.cmd               Windows 双击入口
  bin/probe-domains.mjs          星域表复核探针
  test/                          50 个用例
docs/
  HANDOFF-host-ui-extension.md   宿主 UI 扩展点研究结论（给接手者）
```

## 安装

复制 `pelican-test/` 到天枢的插件目录，然后重启或开新会话：

```
<天枢数据目录>\.rivet\plugins\pelican-test
```

Windows 上通常是 `D:\Tianshu\TianshuData\.rivet\plugins\pelican-test`。

插件启停按天枢规则**从下一个新会话生效**；但**改动已加载插件的代码必须重启天枢**（原因见「已知问题」）。

## 用法

双击 `pelican-test\bin\鹈鹕测试.cmd`，或：

```
node pelican-test\bin\pelican-open.mjs --domain=瑶光 --model=deepseek-flash --title="想测什么"
```

会建一个沙箱工作区，并开一个 cwd 指向它的会话。会话里每轮自动带上环境说明（工作区、剩余时间、星域），并明确要求结果必须来自真实执行。

会话里也可以用工具：

| 工具 | 作用 |
|---|---|
| `pelican_open` | 开新沙箱 + 建会话（可指定 `title` / `domain` / `model`） |
| `pelican_status` | 列活跃沙箱、剩余时间、星域·模型 |
| `pelican_archive` | 立刻归档，不等 72 小时 |

### 鹈鹕测试：说一句就够

在沙箱会话里输入 **「鹈鹕测试」**，插件在该轮自动把下面这条完整提示词塞进会话：

```
创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试。
```

下一轮说别的话，这段自动收回，只保留沙箱环境说明。触发词判定宽松——句子里出现「鹈鹕测试」（中间允许空白）即命中。

## 验证

```
cd pelican-test
node --test test/*.test.js
```

50 个用例：沙箱生命周期 10、HTTP 封装 8、插件接线 8、星域 7、提示词 17。

## 已知问题

- **注入块必须带插件根标签**：宿主 `promptContext.setBlock` 用 `/^<([A-Za-z][\w.-]*)[\s>/]/` 取第一个标签名，并要求它以插件 id 开头，否则**整块静默丢弃且不报错**。插件早期版本输出的是 `## 鹈鹕沙箱` 纯 markdown，因此沙箱提示词实际从未注入成功。现已在 `pelican-test/lib/prompt.js` 用 `<pelican-test>…</pelican-test>` 包裹修复。
- **改插件代码后必须重启天枢**：宿主加载插件用的是 `await import(pathToFileURL(entry).href)`，没有 cache-busting，Node 的 ESM 缓存会让同一进程内改过的模块不再重载。新放进 `\.rivet\plugins\` 的插件不受影响（首次 import 会加载），别把这两种情况搞混。
- **端到端复验待办**：重启天枢后新建沙箱、在会话里说「鹈鹕测试」，期望沙箱 workspace 出现 `.html` 文件、且模型首轮直接动手而不是反问。判定用产物和会话事件（`GET /sessions/<id>/events`），不要用 `provider-calls.jsonl`——该日志不记系统提示正文。

## 设计边界

- **不代劳结果**：插件只开通道、报状态，不产出任何测试结论，也没有预置示例结果。测试跑成什么样只取决于用户真跑的那一次。
- **不做白名单**：星域填错也照建，建完提示「宿主不认识这个星域」。这是通道，不是闸门。
- **不固定测试内容**：插件里唯一的固定提示词就是「鹈鹕测试」那一条（用户输入触发词才注入，其余轮次不出现）；用户想跑任何别的东西，直接在会话里说即可。
- **提示词注入防护**：`domain` / `model` 由调用方随便填、宿主不校验，所以拼进系统提示词前都做了净化——`domain` 认不出就只写「（未识别）」不带原文，`model` 只放行 `[A-Za-z0-9._:/-]` 字符集并截断。不净化的话，往 `--domain` 里塞 `\n\n## 新规则\n…` 能让提示词真的多出一个一级标题（实测过）。见 `pelican-test/lib/prompt.js` 的 `safeValue` / `safeModel`。
- **关于「插件能拿多大权限」**：`promptContext` 本身不是提权通道——插件 manifest 声明了 `fs: true` / `net: true`，本来就能读写磁盘、发网络请求，比注入一段静态文本强得多。真正决定信任边界的是你装不装这个插件，不是它往提示词里写什么。
- **记忆隔离的硬边界**：工作区隔离做到了（沙箱有独立 `.rivet`），但全局记忆插件 `xiaosi-axiom` 的库按用户存一份、检索不带 project 过滤，跨会话共享无法由本插件阻断。彻底隔离只能让天枢跑在独立数据目录里。
