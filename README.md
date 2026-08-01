# TypeLog 字迹

一个 Obsidian 打字统计插件。核心是分清楚两件事：文件里最终留下了多少字，以及你实际敲了多少字——毕竟删了重写也算劳动，普通的字数统计体现不出来。

## 能做什么

- 净字数和累计输入量分开记。累计输入从文件创建起只增不减，删掉的、替换掉的都算
- 自动判断你是在编辑还是在挂机，超过设定时间没动静就暂停计时
- 打字速度：最近 60 秒的字符/分钟，顺带记录会话内的峰值
- 每日字数、时长目标，用环形图显示进度，超额了也正常算（比如目标 100 打了 110，就显示 110%）
- 当月打字热力图，GitHub 那种格子图，哪天写过、写得多不多一眼能看出来
- 字数增长曲线按分钟记录，能看到自己的写作节奏
- 数据全在本地，支持导出 JSON / CSV，也能一键清空所有历史

## 安装

社区商店里搜「TypeLog 字迹」，或者手动装：

1. 下载 `main.js`、`manifest.json`、`styles.css`
2. 放到 vault 的 `.obsidian/plugins/typelog/` 目录
3. 重启 Obsidian，在设置 → 第三方插件里启用

## 使用

打开任意 Markdown 文件开始打字就行。左下角状态栏显示当前速度、字数和今日输入，点一下能看到详情卡片。左侧功能区的图标和命令面板里搜「TypeLog」都能打开统计面板。

## 数据存在哪

- 文件层：`vault/.typelog/file-stats.json`
- 工程层：`vault/.typelog/project.json`
- 全局层：`~/.typelog/global.json`（跨库累计）

## 开发

```bash
npm install
npm run dev      # 开发模式（watch）
npm run build    # 构建
npm test         # 测试
```

## 许可证

MIT
