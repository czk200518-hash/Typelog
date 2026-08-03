# TypeLog 字迹

> **TypeLog** is a typing statistics plugin for Obsidian. It separates **net output** from **total input**: every keystroke you type (including deletions and rewrites) is tracked, so your real writing effort is measured, not just what remains in the file. All data is stored locally.

一个 Obsidian 打字统计插件。核心是分清楚两件事：文件里最终留下了多少字，以及你实际敲了多少字——毕竟删了重写也算劳动，普通的字数统计体现不出来。

---

## English

**TypeLog** is a privacy-first typing statistics plugin for Obsidian that records how you actually write.

Instead of counting only the words that survive in your file, TypeLog tracks every keystroke you type — including deletions and rewrites — so "total work" and "net output" are measured separately. Everything is stored locally in your vault; nothing is ever sent to the network.

### Features

- **Dual-track statistics**: net word count (what remains in the file) vs. total input (every keystroke ever typed, including deleted and replaced text)
- **Smart idle detection**: automatically pauses active-time tracking after a configurable period without edits
- **Typing speed**: real-time CPM/WPM over a 60-second sliding window, plus session peak speed
- **Daily goals**: set a daily word or time target and track progress with a ring chart (progress beyond 100% is shown normally, e.g. 110 typed against a goal of 100)
- **Typing heatmap**: a GitHub-style calendar heatmap of your activity, plus per-minute growth curves
- **Three-layer local storage**: file-level / project-level / global-level statistics, with JSON and CSV export
- **Pomodoro reminder**: optional break reminder after a set period of continuous active editing

### Installation

Search for **TypeLog** in the community plugin store, or install manually:

1. Download `main.js`, `manifest.json` and `styles.css`
2. Place them in `.obsidian/plugins/typelog/` inside your vault
3. Restart Obsidian and enable the plugin in Settings → Community plugins

### Usage

Open any Markdown file and start typing. The status bar shows your current speed, net words and today's total input; click any value for a detailed stats card. You can also open the full dashboard from the ribbon icon in the left sidebar or via the command palette ("TypeLog: Open stats window").

### Where data is stored

- File level: `vault/.typelog/file-stats.json`
- Project level: `vault/.typelog/project.json`
- Global level: `~/.typelog/global.json` (across all vaults)

### Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm test         # run tests
```

### License

MIT

---

## 中文说明

### 能做什么

- 净字数和累计输入量分开记。累计输入从文件创建起只增不减，删掉的、替换掉的都算
- 自动判断你是在编辑还是在挂机，超过设定时间没动静就暂停计时
- 打字速度：最近 60 秒的字符/分钟，顺带记录会话内的峰值
- 每日字数、时长目标，用环形图显示进度，超额了也正常算（比如目标 100 打了 110，就显示 110%）
- 当月打字热力图，GitHub 那种格子图，哪天写过、写得多不多一眼能看出来
- 字数增长曲线按分钟记录，能看到自己的写作节奏
- 数据全在本地，支持导出 JSON / CSV，也能一键清空所有历史

### 安装

社区商店里搜「TypeLog 字迹」，或者手动装：

1. 下载 `main.js`、`manifest.json`、`styles.css`
2. 放到 vault 的 `.obsidian/plugins/typelog/` 目录
3. 重启 Obsidian，在设置 → 第三方插件里启用

### 使用

打开任意 Markdown 文件开始打字就行。左下角状态栏显示当前速度、字数和今日输入，点一下能看到详情卡片。左侧功能区的图标和命令面板里搜「TypeLog」都能打开统计面板。

### 数据存在哪

- 文件层：`vault/.typelog/file-stats.json`
- 工程层：`vault/.typelog/project.json`
- 全局层：`~/.typelog/global.json`（跨库累计）

### 开发

```bash
npm install
npm run dev      # 开发模式（watch）
npm run build    # 构建
npm test         # 测试
```

### 许可证

MIT
