# TypeLog

> [中文介绍](README_zh.md)

An Obsidian plugin for typing statistics. It tracks **net output** (words remaining in the file) and **total input** (every keystroke, including deletions and rewrites) separately. All data is stored locally.

## Features

- **Dual-track statistics**: net word count vs. total input (deletions and rewrites included)
- **Active time tracking**: pauses automatically after a configurable idle period
- **Typing speed**: real-time CPM over a 60-second sliding window, plus session peak
- **Daily goals**: word/time targets with ring progress (values above 100% shown as-is)
- **Typing heatmap**: monthly calendar grid, per-minute word-growth chart
- **Three-layer storage**: file / project / global statistics, JSON and CSV export
- **Pomodoro reminder**: optional break reminder after continuous active editing

## Installation

Search for **TypeLog** in the community plugin store, or install manually:

1. Download `main.js`, `manifest.json`, `styles.css`
2. Place them in `.obsidian/plugins/typelog/` inside your vault
3. Restart Obsidian and enable the plugin

## Usage

Open a Markdown file and start typing. The status bar shows current speed, net words and today's total input; click any value for details. Open the full dashboard from the ribbon icon or the command palette ("TypeLog: Open stats window").

## Data location

- File level: `vault/.typelog/file-stats.json`
- Project level: `vault/.typelog/project.json`
- Global level: `~/.typelog/global.json` (across all vaults)

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm test         # run tests
```

## License

MIT
