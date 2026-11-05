# 宿主 UI 扩展点：研究结论与接手说明

目标：让插件能在天枢桌面端「新建任务」里加一项「新建测试会话」，并标明「72 小时后自动归档」。

这份文档记录的是**实测出来的宿主事实**，不是推测。每条都标了验证方法，接手的人可以自己复现。

---

## 一、插件侧已经就绪的部分

不需要重做：

- 沙箱生命周期（`pelican-test/lib/sandbox.js`）：分配工作区、写 meta、72h 过期判定、归档移动
- 建会话通道（`pelican-test/lib/host-api.js`）：`POST /sessions`、`DELETE /sessions/{id}`
- 工具接口（`pelican-test/index.js`）：`pelican_open` / `pelican_status` / `pelican_archive`
- 沙箱内提示词注入（`pelican-test/lib/prompt.js`）：判断依据是会话 cwd 落在沙箱目录下

缺的只有 UI 入口。宿主侧一旦开放扩展点，插件这边只需要在 `tianshu.plugin.json` 的 `contributes` 里加一项声明，并在 `activate()` 里把「新建测试会话」这个动作接到已有的 `pelican_open` 逻辑上。

---

## 二、宿主事实（全部实测）

### 2.1 TPI 插件没有 UI 注入能力

```bash
# capabilities 只认这 8 个，写错任何一个整个清单失效
# tools | storage | account | embeddings | sidePathLLM | promptContext | transcripts | log
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:<port>/plugins/installed
```

返回里能看到的插件元数据只有 `name / displayName / version / description / entry / installPath / toolCount / toolNames / capabilities / enabled`。前端拿它渲染插件中心，不会拿它渲染「新建任务」菜单。

`contributes` 里现行可用的键：`tools`、`lifecycle`、`skills`。没有 `menus` / `commands` / `views` 之类。

### 2.2 桌面端 UI 不在磁盘可编辑范围内

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:<port>/   # → 404 application/json
ls /d/Tianshu/                                                                      # 只有 mobile-web 一套 web 资产
```

- 本地 HTTP server 只提供 API，不提供 UI
- `mobile-web/` 是手机端那套，桌面端 UI 打包在 `tianshu-desktop.exe`（169,564,672 字节）里
- 旁证：i18n 键 `noProjectScratchTarget`（"未选项目 → 会话落到临时会话目录"）在 `mobile-web/assets/resources.zh-CN-*.js` 里出现 1 次，在 `client-*.js` 里出现 **0 次** —— 说明桌面端「新建任务」对话框是另一套前端代码

### 2.3 宿主本地 API 的能力面（可直接复用）

server 位置：`<天枢数据目录>\.rivet\server-info.json`，内容是 `{port, host, token}`，鉴权用 `Authorization: Bearer <token>`。

| 端点 | 行为 | 实测 |
|---|---|---|
| `GET /sessions` | 列会话 | 200 |
| `GET /sessions/{id}` | 单个会话 | 200，含 `cwd` / `workspaceSource` / `domain` / `domainGlyph` / `model` |
| `POST /sessions` | 建会话，body 可带 `cwd` / `title` / `domain` / `model` | 201 |
| `DELETE /sessions/{id}` | **归档**（不是硬删） | 200 `{"archived":true}` |
| `GET /scratch` | 临时会话根目录 | 200 `{"root":"...\\.rivet\\workspace"}` |
| `GET /plugins/installed` | 已装插件清单 | 200 |

### 2.4 两个参数宿主都不校验（重要）

```bash
# domain 填错也回 201，只是图标落兜底
POST /sessions {"cwd":"D:/x","domain":"not_a_domain"}
# → 201 {"domain":"not_a_domain","domainGlyph":"⚙"}
```

- `domain`：15 个真星域有专属图标，其余（含拼错的 `kaoyang`、不在表里的 `tanlang`）一律落 `⚙`。插件侧因此自带一份参考表并事后提示，但不拦。
- `model`：完全透传，非法模型名也 201，要到首轮对话才报错。

复核脚本：`pelican-test/bin/probe-domains.mjs`。

### 2.5 已经有 scratch 机制

新建任务时不选项目，会话会落到 `<数据目录>\.rivet\workspace`。宿主也确实在管这个目录（`GET /scratch`、`/scratch/cleanup`）。

**但它不带 72 小时归档，UI 上也没有任何标注。**

---

## 三、需要宿主提供什么

最小可行的扩展点，建议形态：

```jsonc
// tianshu.plugin.json
{
  "contributes": {
    "newTaskActions": [
      {
        "id": "pelican-test.open",
        "label": "新建测试会话",
        "hint": "72 小时后自动归档",
        "icon": "🧪",
        "action": "tool:pelican_open"   // 或 http:POST /sessions 的预置模板
      }
    ]
  }
}
```

前端「新建任务」列表拿这份声明渲染一项，点击后走宿主已有的 `POST /sessions` 通道，`cwd` 由插件给出。

洁癖一点的做法是让 `action` 指向一个插件回调而不是写死 HTTP，这样插件能在建会话前后做沙箱分配和 meta 写入。

配套要给的是 `capabilities` 白名单里加一项（例如 `newTaskActions`），否则清单会像下面这样整体失效：

```
"invalid":"capabilities.1: Invalid option: expected one of \"tools\"|\"storage\"|..."
```

---

## 四、踩过的坑

1. **`capabilities` 是硬白名单**：写进一个不存在的 capability，整个插件清单作废，`toolCount` 变 0。开发时用 `GET /plugins/installed` 看 `invalid` 字段，别只看文件写没写对。
2. **插件启停从下一个新会话生效**：热加载会打碎前缀缓存，所以改完必须开新会话才能验证，别以为没生效就是写错了。
3. **`DELETE /sessions/{id}` 是归档不是删除**：回执是 `{"archived":true}`，会话仍可在归档区找到。
4. **`node --test test/` 在 Node 24 下不工作**：要写成 `node --test test/*.test.js`，否则报 `Cannot find module ...\test`。
5. **`.cmd` 里中文会乱码**：cmd 默认 GBK，node 输出 UTF-8，脚本开头要 `chcp 65001 >nul`。
6. **插件的数据目录不要猜**：`host.storage.dataDir()` 可能是 `<rivet根>` 也可能是 `<rivet根>/plugin-data/<插件id>`，稳妥做法是从它向上找 `server-info.json` 来定位插件根。

---

## 五、验证基线

改动前先跑一遍，确认接收到的代码是好的：

```bash
cd pelican-test
node --test test/*.test.js     # 期望 35 passed
```

端到端（会真的建一个会话，用完记得归档）：

```bash
node bin/pelican-open.mjs --domain=瑶光 --title="handoff 验证"
```

期望输出五段：沙箱 id、会话 id、星域、模型、工作区、到期时间。
