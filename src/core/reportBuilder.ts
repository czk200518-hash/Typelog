// Markdown 统计报告生成器（纯逻辑，无 Obsidian 依赖，便于单测）
// 两种模板：完整版（总览 + 趋势 + 24h 热力 + 活跃文件 Top10 + 终身累计）/ 精简版（总览 + 趋势 + 终身累计）；
// 时间范围：近 7 天 / 近 30 天 / 本月（含今天）；报告为纯 Markdown 表格 + █░ 文本方块，任何主题下正常渲染。
import { dateKey, formatDuration, formatNumber, pad2 } from "./format";
import { t } from "./i18n";
import type { FileStats, GlobalStats } from "../types";

export type ReportTemplate = "full" | "brief";
export type ReportRangeDays = 7 | 30;
export type ReportRange = ReportRangeDays | "month";

export interface ReportInput {
  global: GlobalStats;
  // 文件级统计（调用方应已过滤被删除文件）
  files: FileStats[];
  pluginVersion: string;
  vaultName?: string;
}

// 活跃文件排行（Top N）：按指标排序取前 N，仅保留正数值条目。
// 与「功能 2 排行弹窗」共享此排序逻辑（净字数估算 = 累计输入 - 删除）
export function topActiveFiles(files: FileStats[], sortBy: "gross" | "active" | "net", limit: number): FileStats[] {
  const val = (f: FileStats) =>
    sortBy === "gross" ? f.grossTyped : sortBy === "active" ? f.activeTimeMs : Math.max(0, f.grossTyped - f.deletedChars);
  return [...files]
    .filter((f) => val(f) > 0)
    .sort((a, b) => val(b) - val(a))
    .slice(0, limit);
}

// 读取某日某小时的活跃毫秒。
// 兼容两种热力图结构：旧格式 number[]（直接为活跃 ms）与新格式 { activeMs, grossByHour }（优化 3 引入）
export function heatHourValue(hours: unknown, idx: number): number {
  if (Array.isArray(hours)) return (hours[idx] as number) ?? 0;
  if (hours && typeof hours === "object" && "activeMs" in (hours as Record<string, unknown>)) {
    const arr = (hours as { activeMs: number[] }).activeMs;
    return arr?.[idx] ?? 0;
  }
  return 0;
}

// 范围对应的日期键列表（YYYY-MM-DD，含今天）
function rangeKeys(now: Date, range: ReportRange): string[] {
  const keys: string[] = [];
  if (range === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let d = first; d <= now; d.setDate(d.getDate() + 1)) keys.push(dateKey(d));
    return keys;
  }
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    keys.push(dateKey(d));
  }
  return keys;
}

function rangeLabel(range: ReportRange): string {
  if (range === 7) return t("report.rangeLast7");
  if (range === 30) return t("report.rangeLast30");
  return t("report.rangeMonth");
}

// 热力文本方块：相对最大值缩放到 5 格（█░）
function heatBlocks(minutes: number, maxMinutes: number): string {
  if (minutes <= 0) return "";
  const blocks = Math.max(1, Math.min(5, Math.round((minutes / Math.max(1, maxMinutes)) * 5)));
  return "█".repeat(blocks) + "░".repeat(5 - blocks);
}

export interface ReportOptions {
  template: ReportTemplate;
  range: ReportRange;
  // 注入当前时间便于单测
  now?: Date;
}

export function buildMarkdownReport(input: ReportInput, opts: ReportOptions): string {
  const now = opts.now ?? new Date();
  const keys = rangeKeys(now, opts.range);
  const g = input.global;

  // 本期聚合（总览与峰值）
  let gross = 0;
  let activeMs = 0;
  let peak = 0;
  for (const k of keys) {
    gross += g.dailyGrossByDate[k] ?? 0;
    activeMs += g.dailyActiveByDate[k] ?? 0;
    const p = g.dailyPeakByDate[k] ?? 0;
    if (p > peak) peak = p;
  }

  const lines: string[] = [];
  lines.push(`# ${t("report.title")}`);
  lines.push("");
  lines.push(
    `> ${t("report.generatedAt")}：${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
  );
  lines.push(`> ${t("report.range")}：${keys[0]} ~ ${keys[keys.length - 1]}（${rangeLabel(opts.range)}）`);
  lines.push("");

  // ---- 本期总览 ----
  lines.push(`## ${t("report.overview")}`);
  lines.push(`| ${t("report.metric")} | ${t("report.value")} |`);
  lines.push("|------|------|");
  lines.push(`| ${t("report.grossTyped")} | ${formatNumber(gross)} ${t("report.unitsChars")} |`);
  lines.push(`| ${t("report.activeTime")} | ${formatDuration(activeMs)} |`);
  lines.push(`| ${t("report.peakSpeed")} | ${formatNumber(peak)} ${t("report.unitsCpm")} |`);
  lines.push("");

  // ---- 每日趋势 ----
  lines.push(`## ${t("report.dailyTrend")}`);
  lines.push(`| ${t("report.date")} | ${t("report.grossTyped")} | ${t("report.activeTime")} | ${t("report.peakSpeed")} |`);
  lines.push("|------|---------|---------|---------|");
  for (const k of keys) {
    lines.push(
      `| ${k.slice(5)} | ${formatNumber(g.dailyGrossByDate[k] ?? 0)} | ${formatDuration(g.dailyActiveByDate[k] ?? 0)} | ${formatNumber(g.dailyPeakByDate[k] ?? 0)} |`,
    );
  }
  lines.push("");

  // ---- 24h 热力（仅完整版）----
  if (opts.template === "full") {
    lines.push(`## ${t("report.hourlyHeat")}`);
    lines.push(`| ${t("report.hour")} | ${t("report.activity")} |`);
    lines.push("|------|--------|");
    // 聚合范围内各小时总活跃毫秒
    const hourTotal = new Array<number>(24).fill(0);
    for (const k of keys) {
      const hours = g.heatmap[k];
      if (!hours) continue;
      for (let h = 0; h < 24; h++) hourTotal[h] += heatHourValue(hours, h);
    }
    const hourMin = hourTotal.map((ms) => ms / 60_000);
    const maxMin = Math.max(...hourMin, 1);
    for (let h = 0; h < 24; h++) {
      const m = hourMin[h];
      if (m <= 0) continue;
      lines.push(`| ${pad2(h)}:00 | ${heatBlocks(m, maxMin)} ${Math.round(m)}${t("report.minUnit")} |`);
    }
    lines.push("");

    // ---- 活跃文件 Top10（仅完整版）----
    lines.push(`## ${t("report.topFiles")}`);
    const top = topActiveFiles(input.files, "gross", 10);
    if (top.length === 0) {
      lines.push(`> ${t("report.noData")}`);
    } else {
      lines.push(`| # | ${t("report.file")} | ${t("report.grossTyped")} | ${t("report.activeTime")} |`);
      lines.push("|---|------|---------|---------|");
      top.forEach((f, i) => {
        lines.push(`| ${i + 1} | ${f.path} | ${formatNumber(f.grossTyped)} | ${formatDuration(f.activeTimeMs)} |`);
      });
    }
    lines.push("");
  }

  // ---- 终身累计 ----
  lines.push(`## ${t("report.lifetime")}`);
  lines.push(`- ${t("report.grossTyped")}：${formatNumber(g.grossTypedTotal)} ${t("report.unitsChars")}`);
  lines.push(`- ${t("report.deletedChars")}：${formatNumber(g.deletedCharsTotal)} ${t("report.unitsChars")}`);
  lines.push(`- ${t("report.netOutput")}：${formatNumber(Math.max(0, g.grossTypedTotal - g.deletedCharsTotal))} ${t("report.unitsChars")}`);
  lines.push("");

  // 尾部元信息
  lines.push(`---`);
  lines.push(`*${t("report.generatedBy")} TypeLog v${input.pluginVersion}${input.vaultName ? ` · ${t("report.vault")} ${input.vaultName}` : ""}*`);

  return lines.join("\n");
}
