# 鹈鹕测试（pelican-test）

一键开一个隔离的测试沙箱会话，72 小时后自动归档。

## 一键用法

双击 `bin\鹈鹕测试.cmd`。

它会：建沙箱 → 调宿主本地 API 建会话（cwd 指向沙箱）→ 打印会话 id。新会话立刻出现在天枢的会话列表里。

数据目录不用配——启动器从自己所在位置向上找 `.rivet`，换盘换机器都一样；要指定根部就用 `--root=`。

挑星域和模型（不同星域/模型跑出来的结果不一样，这两个值会连同沙箱一起记进 meta）：

```
bin\鹈鹕测试.cmd --domain=瑶光 --model=glm:glm-5.3-flash
node bin\pelican-open.mjs --domain=yaoguang --title="想测什么"
```

## 沙箱里自带说明

进了沙箱会话不用再交代「这是临时环境」——插件每一轮自动注入一段：

```
<pelican-test>
## 鹈鹕沙箱

你在一个临时沙箱里工作，不是用户的真实项目。

- 工作区：...\pelican\sessions\<id>\workspace
- 到期：2026/11/8 19:20（还剩 71h58m）
- 星域：瑶光(↻)　模型：deepseek-flash

可以随便试：改坏、删光、重写，都不影响用户的项目。到期后这个会话会自动归档，
工作区移进 archive/。想提前结束就说一声（pelican_archive）。
想在别的星域或模型上再跑一遍，用 pelican_open 开一个新的沙箱。
</pelican-test>
```

外面那层 `<pelican-test>` 是必须的：宿主 `promptContext.setBlock` 用 `/^<([A-Za-z][\w.-]*)[\s>/]/` 取第一个标签名并要求它以插件 id 开头，不带标签的纯 markdown 会被**静默丢弃、不报错**。插件早期版本就是纯 markdown，所以这段提示词实际从未注入成功。

判断依据是会话的 cwd 落在沙箱目录下——普通项目会话一个字都不注入；沙箱归档后这一块会自动清空，不会留着过期信息。

## 「鹈鹕测试」触发词

在沙箱会话里输入 **「鹈鹕测试」**，插件在该轮把完整提示词塞进注入块：

```
## 鹈鹕测试

用户这句「鹈鹕测试」等于请求执行下面这条完整提示词。直接开始做，不用再问要不要开工：

> 创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试。
```

- 判定宽松：句子里出现「鹈鹕测试」（中间允许空白）即命中，见 `lib/prompt.js` 的 `isPelicanTestRequest`。
- **一次性**：只在命中那一轮注入，下一轮说别的话就收回，不会每轮重复。
- 提示词原文存于 `lib/prompt.js` 的 `PELICAN_TEST_PROMPT`，一字不改。

## 不代劳结果

插件只开通道、报状态，**不产出任何测试结论**：没有预置的示例结果，没有评分，没有「测试通过」的汇总。

- `pelican_open` 返回的是环境事实：会话 id、工作区、星域、模型、到期时间
- `pelican_status` 列的是沙箱状态和剩余时间
- 测试跑成什么样，只取决于用户在那个沙箱里真跑的那一次

注入的提示词里也把这条钉死了，防模型自己编排：

> 结果必须来自真实执行：没跑过的测试不要说跑过了，跑挂了就把报错原样贴出来，不要替用户总结成「测试通过」。用户要的是这次真跑出来的东西。

## 星域（参考，不是限制）

填 id 或中文名都行，大小写不敏感。下面是实测认得的，填别的也照建——这是个通道，不设闸门：

| 星域 | id | 图标 | 星域 | id | 图标 |
|---|---|---|---|---|---|
| 天枢 | `tianshu` | ✵ | 破军 | `pojun` | ☄ |
| 天权 | `tianquan` | ⚖ | 天机 | `tianji` | ⚝ |
| 天璇 | `tianxuan` | ☾ | 瑶光 | `yaoguang` | ↻ |
| 长庚 | `changgeng` | ☽ | 太一 | `taiyi` | ◉ |
| 天府 | `tianfu` | ❖ | 天梁 | `tianliang` | ✧ |
| 文曲 | `wenqu` | ✺ | 开阳 | `kaiyang` | ☌ |
| 启明 | `qiming` | ☥ | 辅 | `fu` | ⊕ |
| 华盖 | `huagai` | ☉ | | | |

宿主对 `domain` 不校验：填 `kaoyang` 也回 201，只是图标落成兜底 ⚙、会话没有星域人格。所以这里不拦——填了不认识的，建完会明确告诉你「宿主不认识星域 X」，你可以接着用，也可以归档重开。

模型名同样不校验，拼错会在首轮报错，看得见。

复核这份表：`node bin\probe-domains.mjs --root=D:\Tianshu\TianshuData\.rivet`（逐个建会话读图标再归档）。

表里 id 和图标逐条实测；中文名中「天枢/破军/天权/天机/天璇/瑶光/长庚/太一」八个来自前端注册表，其余按拼音对应——中文名只是输入别名，映射错了最多是别名对不上，不会建错星域。

## 会话里用

插件启用后（插件中心 → 鹈鹕测试），在新会话里说「开始鹈鹕测试」，agent 调 `pelican_open`：

| 工具 | 作用 |
|---|---|
| `pelican_open` | 建沙箱 + 建会话，返回会话 id、工作区、星域与模型。参数：`title` / `domain`（id 或中文名）/ `model` |
| `pelican_status` | 列活跃沙箱、剩余时间 |
| `pelican_archive` | 立刻归档（不等 72 小时） |

插件停用/启用按天枢规则从**下一个新会话**生效。

## 隔离边界（实测，别当成推测）

| 层面 | 是否隔离 | 依据 |
|---|---|---|
| 工作区 | 是 | 沙箱会话的 cwd = `<rivetRoot>/plugin-data/pelican-test/pelican/sessions/<id>/workspace`；天枢的 `.rivet`（todo / plans / 知识 / meridian.db）按 cwd 落盘，所以该项目维度自成一套 |
| 会话列表 | 否 | 沙箱会话与普通会话在同一个列表里，只是 cwd 不同 |
| 全局记忆（xiaosi-axiom） | **否** | 记忆库是 `plugin-data/xiaosi-axiom/memory-<userKey>.db`，每用户一份；`lib/retrieve.js`、`lib/cascade.js` 检索不带 project 过滤（project 只作为列存在于 `lib/store.js`），所以其他会话的记忆会照常注入、鹈鹕的内容也照常写进去 |

要做到记忆彻底隔离，只能让天枢跑在独立数据目录里（第二个实例）——桌面端是否支持多数据目录未验证，本插件不承诺。

## 归档

- 触发：每次 `turnStart` 惰性扫描（不依赖定时器）+ `pelican_archive` 手动
- 动作：先 `DELETE /sessions/{id}`（天枢把删除实现为归档，回 `{"archived":true}`），再把沙箱目录移进 `archive/`
- **已经归档过的会话再删会回 404**，按幂等成功处理，不报错
- **目录被会话进程占用时**（Windows 上常见）不能立刻搬走：会话照样归档，沙箱 meta 标成 `pending-archive`，下一轮 `turnStart` 自动重试，不会谎称已归档
- 保留期：`RETENTION_MS = 72h`，写死在 `lib/sandbox.js`

## 目录布局

```
<rivetRoot>/plugin-data/pelican-test/pelican/
  sessions/<id>/meta.json     沙箱元数据（createdAt / expiresAt / sessionId / status）
  sessions/<id>/workspace/    会话 cwd
  archive/<id>/               归档后
```

## 测试

```
node --test test/*.test.js
```

50 个用例：沙箱生命周期 10、HTTP 封装 8、插件接线 8、星域 7、提示词 17。覆盖沙箱生命周期、HTTP 封装形状（用假宿主服务）、插件接线、到期归档与「鹈鹕测试」触发。
