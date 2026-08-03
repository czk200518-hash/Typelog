# TypeLog 中文介绍

TypeLog 是 Obsidian 的打字统计插件，把「净字数」和「累计输入」分开统计：

- **净字数**：文件最终保留的字数
- **累计输入**：包括删改在内的全部击键量

## 功能

- 双轨统计：净字数 vs 累计输入（含删改）
- 活跃时长：编辑一段时间无操作后自动暂停计时
- 打字速度：最近 60 秒滑动窗口的字符/分钟，含会话峰值
- 每日目标：字数/时长目标，环形进度显示（可超过 100%）
- 打字热力图：月度日历格 + 每分钟字数增长曲线
- 三层存储：文件级 / 工程级 / 全局级统计，支持 JSON / CSV 导出
- 番茄钟：连续编辑一段时间后提醒休息

## 安装

社区商店搜索 **TypeLog**，或手动安装：

1. 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入 vault 的 `.obsidian/plugins/typelog/` 目录
3. 重启 Obsidian 并启用插件

## 使用

打开任意 Markdown 文件开始打字。状态栏显示当前速度、字数和今日累计输入，点击任意数值查看详情；也可通过左侧功能区图标或命令面板（"TypeLog: Open stats window"）打开完整统计面板。

## 数据存储位置

- 文件级：`vault/.typelog/file-stats.json`
- 工程级：`vault/.typelog/project.json`
- 全局级：`~/.typelog/global.json`（跨库累计）

## 许可证

MIT
