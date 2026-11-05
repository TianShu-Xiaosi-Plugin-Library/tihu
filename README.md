# tihu — 鹈鹕测试通道

给想随手试点东西的人一个隔离通道：开一个沙箱会话，工作区与真实项目分开，72 小时后自动归档。

天枢（tianshu harness 4.0.1）的 TPI 插件。

## 目标形态

插件激活后，**每个项目的「新建任务」里多一项「新建测试会话」**，并标明「72 小时后自动归档」。

## 当前状态

| 部分 | 状态 |
|---|---|
| 沙箱会话开通（独立工作区 + 建会话） | ✅ 已完成并实测 |
| 72 小时自动归档 | ✅ 已完成并实测 |
| 沙箱内自动注入环境说明（含「不许编造结果」） | ✅ 已完成并实测 |
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
  lib/prompt.js                  沙箱内注入的提示词
  bin/pelican-open.mjs           一键启动器
  bin/鹈鹕测试.cmd               Windows 双击入口
  bin/probe-domains.mjs          星域表复核探针
  test/                          35 个用例
docs/
  HANDOFF-host-ui-extension.md   宿主 UI 扩展点研究结论（给接手者）
```

## 安装

复制 `pelican-test/` 到天枢的插件目录，然后重启或开新会话：

```
<天枢数据目录>\.rivet\plugins\pelican-test
```

Windows 上通常是 `D:\Tianshu\TianshuData\.rivet\plugins\pelican-test`。

插件启停按天枢规则**从下一个新会话生效**。

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

## 验证

```
cd pelican-test
node --test test/*.test.js
```

35 个用例：沙箱生命周期 7、HTTP 封装 6、插件接线 8、星域 7、提示词 7。

## 设计边界

- **不代劳结果**：插件只开通道、报状态，不产出任何测试结论，也没有预置示例结果。测试跑成什么样只取决于用户真跑的那一次。
- **不做白名单**：星域填错也照建，建完提示「宿主不认识这个星域」。这是通道，不是闸门。
- **记忆隔离的硬边界**：工作区隔离做到了（沙箱有独立 `.rivet`），但全局记忆插件 `xiaosi-axiom` 的库按用户存一份、检索不带 project 过滤，跨会话共享无法由本插件阻断。彻底隔离只能让天枢跑在独立数据目录里。
