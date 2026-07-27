# 云图可见 UI 采集器（Yuntu visible-UI collector）

本工具通过 **Chrome DevTools Protocol（CDP）** 连接你已经手动打开并登录的云图页面，只操作页面上**可见**的控件：筛选日期、搜索品牌、读取列表指标、打开详情、校验播放、下载视频，并写入本地 JSONL/CSV。

它**不会**代替你登录，也不会直接读 Cookie/Storage。启动后会在你选定的**已登录云图标签**上，自动 `goto` 到 `config.json` 里的 `pageUrlPrefix`（并保留当前标签 URL 上的 query，例如 `aadvid`）。结束时会断开 CDP，不会关闭 Chrome。

---

## 适用场景

- 在一台已登录云图的电脑上，批量采集 **TA 内容洞察 / 视频偏好** 等页面的素材元数据与视频文件。
- 支持 **macOS / Windows / Linux**，步骤相同，仅启动 Chrome 的命令不同。

不适合：无图形界面服务器、未登录的远程桌面、无人值守且会话过期的环境。

---

## 一、准备环境

### 1. 安装 Node.js

需要 **Node.js 20+** 与 **npm**。

```sh
node -v
npm -v
```

### 2. 获取代码

任选仓库（分支：`codex/yuntu-ui-collector`）：

```sh
git clone https://gitlab.yc345.tv/fengyang1/yuntu_get_data.git
cd yuntu_get_data
git checkout codex/yuntu-ui-collector
```

或：

```sh
git clone https://github.com/IXYTYXI/yuntu_get_data.git
cd yuntu_get_data
git checkout codex/yuntu-ui-collector
```

### 3. 安装依赖并自检

```sh
npm install
npm test
```

全部通过后再继续。本工具通过 CDP 连接**系统已安装的 Google Chrome**，一般**不需要**执行 `npx playwright install`。

---

## 二、配置文件

`config.json` 在 `.gitignore` 中，**不会随仓库下发**，需要在本机创建。

### 方式 A：TA 内容洞察（推荐起点）

仓库提供与当前云图 TA 页面对齐的示例（含 `criteria` 与 selector）：

**macOS / Linux：**

```sh
cp config.example.ta-content.json config.json
```

**Windows（PowerShell）：**

```powershell
Copy-Item config.example.ta-content.json config.json
```

按需修改 `criteria.brands`、阈值、输出路径等。

### 方式 B：从通用模板改

```sh
cp config.example.json config.json
```

自行填写 `pageUrlPrefix`、`selectors`，并增加 `criteria` 块（字段见下文）。

### 路径写法

`output.path`、`download.directory` 必须是**项目根目录下的相对路径**，使用正斜杠，例如：

- `output/materials.jsonl`
- `output/videos`

不要使用 `C:\...`、`../` 或绝对路径。

### `criteria` 字段说明（可选但推荐）

配置中存在 `criteria` 时，采集器会：

1. 打开 `pageUrlPrefix`，并按 `navigationQuery` 进入指定内容模块（TA 示例为 **内容 → 行业灵感激发**，`crowd_tab=industry_intention`）；
2. 在弹层中选择 **「过去 N 天」**（`dateRangeDays` 仅支持 **7 / 15 / 30**）；
3. 在 **细分筛选 → 指定品牌** 中按 `brandSelectionMode` 选品牌（不是顶部搜索框）；
4. 若配置了 `criteria.extractionMethodLabel`，在 **截取方式** 中选择对应项（如 `曝光量TOP30`）；
5. 解析当前列表表格，按阈值过滤后采集；
6. 逐条打开详情采集并下载（非 dry-run 时）。

| 字段 | 含义 | 示例 |
|------|------|------|
| `brandSelectionMode` | `combined`：指定品牌 **一次多选** 全部 `brands`，只筛一次列表；`sequential`（默认）：每个品牌单独选、各采一批 | `"combined"` |
| `navigationQuery` | 打开采集页时附加 query，进入 **行业灵感激发** | `{ "crowd_tab": "industry_intention" }` |
| `criteria.extractionMethodLabel` | **细分筛选** 行的 **截取方式** | `"曝光量TOP30"` |
| `maxResultsPerBrand` | `sequential` 时每个品牌最多条数；`combined` 时为 **合并列表** 最多条数（与 `resultLimit` 取较小值） | `30` |
| `brands` | **指定品牌** 中要选的品牌名（`combined` 时会全部选上） | `["学而思", "猿辅导"]` |
| `dateRangeDays` | 近 N 天（UI 快捷「过去 N 天」） | `7` |
| `maxResultsPerBrand` | 每个品牌最多采集条数 | `30` |
| `minExposure` | 曝光下限（整数，如 10w = `100000`） | `100000` |
| `minThreeSecondCompletionRate` | 3 秒完播率下限（小数） | `0.3` 表示 30% |
| `minCtr` | CTR 下限（小数） | `0.015` 表示 1.5% |

曝光列为区间文案（如 `1000-2000w`）时，按**区间下限**与 `minExposure` 比较。

未配置 `criteria` 时，仅按 `resultLimit` 采集当前可见卡片，不做品牌/日期/指标过滤。

### 页面上的其他筛选项

`filters` 数组用于逐步点击「触发器 → 选项」类控件（如细分人群）。**行业参考值、TOP 排序等**若未写入 `filters`，需要你先在 Chrome 里手动设好，或后续在配置中补充 selector。

---

## 三、启动调试专用 Chrome

必须使用 **独立用户数据目录** 和 **远程调试端口**，与日常 Chrome 分开，避免端口和用户目录冲突。

### macOS

先退出日常 Chrome（或至少不要用同一 `user-data-dir`），再执行：

```sh
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="/tmp/yuntu-chrome-profile"
```

### Windows（PowerShell）

先关闭所有 Chrome 窗口，再执行（路径按本机安装位置调整）：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\temp\yuntu-chrome-profile"
```

### Linux

```sh
google-chrome --remote-debugging-port=9222 --user-data-dir="/tmp/yuntu-chrome-profile"
```

### 在 Chrome 里人工完成

1. 打开 [云图](https://yuntu.oceanengine.com/) 并**登录**（任意子页面即可，例如首页概览）；
2. `--page-index` 指向的标签必须是 **`https://yuntu.oceanengine.com/` 域名下的 https 页面**（不要选 `blob:`、`chrome://` 或 `sw.js` 一类标签）；
3. 采集器启动后会**自动打开** `pageUrlPrefix` 对应路径，并**沿用该标签 URL 上的 query**（如 `aadvid`）；
4. 多标签时传 `--page-index <n>`；若只有一个已登录的云图标签，可省略 `--page-index`。

---

## 四、运行采集

在项目根目录执行。

### 1. 试跑（不下载视频）

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222 --page-index 0 --dry-run
```

Windows 下命令相同（在 `cmd` 或 PowerShell 中运行即可）。

### 2. 正式采集（含下载）

去掉 `--dry-run`：

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222 --page-index 0
```

仅有一个标签页时可省略 `--page-index`：

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222
```

### CLI 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--config <path>` | 是 | 配置文件路径，通常 `config.json` |
| `--cdp-url <url>` | 否 | 默认 `http://127.0.0.1:9222`，仅允许本机 loopback |
| `--page-index <n>` | 多标签时建议 | 从 0 开始的标签页序号 |
| `--dry-run` | 否 | 只采元数据并校验播放，不写入视频文件 |

---

## 五、输出结果

| 产物 | 配置项 | 说明 |
|------|--------|------|
| 元数据 | `output.path` | `jsonl` 每行一条 JSON；`csv` 为表格 |
| 视频 | `download.directory` | 播放校验通过后下载；文件名为 `品牌名-排名.mp4`（criteria 模式）等 |

单条记录包含：品牌、标题、脚本/逐字稿相关字段、列表侧的曝光/3S/CTR、播放状态、下载状态与相对路径。**不会在元数据里保存原始视频 URL。**

---

## 六、部署到新机器（Checklist）

按顺序勾选即可在新 Mac/Windows 上跑通：

- [ ] 安装 Node.js 20+
- [ ] `git clone` 并 `git checkout codex/yuntu-ui-collector`
- [ ] `npm install` && `npm test`
- [ ] 复制 `config.example.ta-content.json` → `config.json`（或从同事处拷贝已验证的 `config.json`）
- [ ] 用**调试端口**启动 Chrome，登录云图并打开目标页
- [ ] `npm start -- --config config.json --dry-run --page-index 0` 确认有记录写出
- [ ] 去掉 `--dry-run` 正式下载

### Windows 迁移注意

- 使用 `Copy-Item` 复制配置；路径仍用 `output/...` 形式。
- Chrome 路径常见为 `C:\Program Files\Google\Chrome\Application\chrome.exe`。
- 公司网络需能访问云图与 Git 远程仓库。

### 定时任务（可选）

可用系统计划任务/cron 定期执行 `npm start`，但**每次运行前**仍需 Chrome 已启动且**仍处于登录状态**；本工具不能自动登录。

---

## 七、常见问题

| 现象 | 处理 |
|------|------|
| 连接 CDP 失败 | 确认 Chrome 以 `--remote-debugging-port=9222` 启动；防火墙勿拦截本机 127.0.0.1 |
| `AUTH_REQUIRED` / 选页失败 | 未登录、`pageUrlPrefix` 与当前 URL 不匹配，或多标签未传 `--page-index` |
| 某条素材 selector 报错 | 云图改版 → 用 DevTools 更新 `config.json` 中 `selectors` |
| 有元数据但 `download` 失败 | 播放未 `verified`、无 `video` 源，或为 **HLS（`.m3u8`）**（当前不支持） |
| 详情抽屉关不掉 | 一般不影响后续条目；可先 Esc/手动关闭再跑 |
| 日期未变 | 确认 `dateRangeDays` 为 7/15/30；关闭遮挡筛选条的抽屉 |

---

## 八、能力边界

当前版本**不支持**：

- 在元数据中持久化媒体 URL；
- 直接读取 Cookie / localStorage；
- 写入飞书多维表格；
- 下载 HLS（`.m3u8`）流。

任何绕过平台可见 UI 的流程需单独合规审批。

---

## 九、维护 selector

云图前端 class 可能随发版变化。若采集大面积失败，在已登录页面用 Chrome DevTools 重新确认：

- 列表卡片 `resultCard`
- 详情抽屉 `detailPanel` / `closeDetail`
- 播放按钮 `playButton` 与 `player`
- 字段区域 `fields.*`

更新 `config.json` 后先 `--dry-run` 验证，再正式下载。
