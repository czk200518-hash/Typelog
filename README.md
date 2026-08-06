# TypeLog

> [中文介绍](README_zh.md)

TypeLog is a typing statistics plugin for Obsidian. It keeps two numbers for every file you edit: the **net output** (what's actually left in the file) and the **total input** (every character you typed, including the ones you deleted or rewrote). Everything stays on your machine — no accounts, no cloud.

## What it does

- **Net vs. gross**: sees through your edits. Deleting and rewriting still count toward your total input, but net words only grows when the file actually gains content.
- **Active time**: counts only while you're actually typing, and pauses itself after you stop for a while (the idle time is configurable).
- **Speed**: CPM over a rolling 60-second window, plus the peak speed of the current session.
- **Goals**: daily and weekly word/time targets, shown as progress rings that keep counting past 100%.
- **Heatmap**: a GitHub-style calendar of your typing hours, switchable between active time and words typed.
- **Trends**: daily bar charts in the stats panel — words, active time, or peak speed over the last 7 or 30 days.
- **Top files**: a ranking of the files where you've spent the most time or typed the most, clickable to jump straight there.
- **Pomodoro**: an optional break reminder after continuous active editing; can count real time or only while you're active.
- **Export**: JSON, CSV (file-level plus daily and hourly heatmap data), or a ready-to-paste Markdown report — full or slim version.
- **Backup & restore**: export everything to a single `.typelog` file and merge it back later, handy when moving vaults or recovering lost data.
- **Custom status bar**: pick which stats to show and in what order, with a mini progress bar for your daily word goal.

## Install

Search "TypeLog" in the community plugin store, or install manually:

1. Download `main.js`, `manifest.json`, `styles.css`
2. Put them in `.obsidian/plugins/typelog/` inside your vault
3. Restart Obsidian and enable the plugin

## Usage

Open a Markdown file and start typing. The status bar shows your current speed and today's numbers; click any item to open the details panel. The ribbon icon, or the command "TypeLog: Open stats window", opens the full dashboard with today's summary and the trend charts.

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm test         # run tests
```

## License

MIT
