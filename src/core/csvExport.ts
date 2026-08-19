// CSV 多区块导出（纯逻辑，便于单测）：
// 区块 A 文件级 → 区块 B 每日统计 → 区块 C 热力图宽表（24 列）→ 区块 D 热力图长表（跳过 0 值小时）。
// 区块头以 # 注释标记（不以 = + - @ 开头，避免 Excel 公式注入）；文件级区块列序与旧版完全一致。
import type { FileStats, GlobalStats } from "../types";
import { heatHourValue } from "./reportBuilder";

// CSV 字段转义：含逗号/引号/换行时加引号包裹并双写内部引号；
// 以 = + - @ 或制表符/回车开头时前置单引号，防止在 Excel 中被当作公式执行（CSV 注入防护）
export function csvField(v: string | number): string {
  const s = String(v);
  const safe = /^[\t\r=+@-]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function buildCsvExport(globalStats: GlobalStats, files: FileStats[], content: "files" | "all"): string {
  const lines: string[] = [];
  // 区块 A：文件级
  lines.push("# 文件级统计");
  lines.push("path,grossTyped,deletedChars,activeTimeMs,firstSeen,lastOpened");
  for (const f of files) {
    lines.push([csvField(f.path), f.grossTyped, f.deletedChars, f.activeTimeMs, f.firstSeen, f.lastOpened].join(","));
  }
  if (content === "files") return "\uFEFF" + lines.join("\n");

  const dates = sortedDateKeys(globalStats);
  // 区块 B：每日统计
  lines.push("");
  lines.push("# 每日统计");
  lines.push("date,grossTyped,activeMs,peakCpm");
  for (const k of dates) {
    lines.push([k, globalStats.dailyGrossByDate[k] ?? 0, globalStats.dailyActiveByDate[k] ?? 0, globalStats.dailyPeakByDate[k] ?? 0].join(","));
  }
  // 区块 C：热力图宽表（24 列，缺失补 0）
  lines.push("");
  lines.push("# 每日热力图（宽表）");
  lines.push(["date", ...Array.from({ length: 24 }, (_, i) => `h${i}`)].join(","));
  for (const k of dates) {
    const hours = globalStats.heatmap[k];
    const cells = Array.from({ length: 24 }, (_, i) => heatHourValue(hours, i) ?? 0);
    lines.push([k, ...cells].join(","));
  }
  // 区块 D：热力图长表（仅非零小时，避免行数爆炸）
  lines.push("");
  lines.push("# 每日热力图（长表）");
  lines.push("date,hour,activeMs");
  for (const k of dates) {
    const hours = globalStats.heatmap[k];
    for (let h = 0; h < 24; h++) {
      const ms = heatHourValue(hours, h);
      if (ms > 0) lines.push([k, h, ms].join(","));
    }
  }
  return "\uFEFF" + lines.join("\n");
}

// 每日统计的所有日期键（daily*/heatmap 并集），字典序升序
export function sortedDateKeys(globalStats: GlobalStats): string[] {
  const set = new Set<string>([
    ...Object.keys(globalStats.dailyActiveByDate),
    ...Object.keys(globalStats.dailyGrossByDate),
    ...Object.keys(globalStats.dailyPeakByDate),
    ...Object.keys(globalStats.heatmap),
  ]);
  return [...set].sort();
}
