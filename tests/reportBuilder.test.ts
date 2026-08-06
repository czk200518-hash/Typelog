// 功能 3：Markdown 统计报告生成器单测（完整/精简模板、范围聚合、热力方块、排行）
import { describe, it, expect } from "vitest";
import { buildMarkdownReport, heatHourValue, topActiveFiles, type ReportInput } from "../src/core/reportBuilder";
import type { FileStats, GlobalStats } from "../src/types";

function fileStats(path: string, grossTyped: number, deletedChars = 0, activeTimeMs = 0): FileStats {
  return { path, grossTyped, deletedChars, activeTimeMs, firstSeen: 1, lastOpened: 1 };
}

function globalStats(): GlobalStats {
  return {
    grossTypedTotal: 1000,
    deletedCharsTotal: 200,
    dailyActiveByDate: {},
    dailyGrossByDate: {},
    dailyPeakByDate: {},
    heatmap: {},
  };
}

// 固定"今天"为 2026-08-06（周四），近 7 天为 07-31 ~ 08-06
const NOW = new Date(2026, 7, 6, 14, 30);

function input(g: GlobalStats, files: FileStats[] = []): ReportInput {
  return { globalStats: g, files, pluginVersion: "1.0.7", vaultName: "工作库" };
}

describe("功能 3：Markdown 统计报告生成", () => {
  it("完整版包含全部区块：总览/趋势/热力/排行/终身", () => {
    const g = globalStats();
    g.dailyGrossByDate["2026-08-06"] = 5210;
    g.dailyActiveByDate["2026-08-06"] = 5_400_000;
    g.dailyPeakByDate["2026-08-06"] = 78;
    g.heatmap["2026-08-06"] = new Array<number>(24).fill(0);
    g.heatmap["2026-08-06"][14] = 300_000; // 14 时活跃 5 分钟
    const files = [fileStats("笔记/日记.md", 15230, 431, 7_200_000)];
    const md = buildMarkdownReport(input(g, files), { template: "full", range: 7, now: NOW });
    expect(md).toContain("# TypeLog 统计报告");
    expect(md).toContain("## 本期总览");
    expect(md).toContain("## 每日趋势");
    expect(md).toContain("## 活跃时段（24 小时热力）");
    expect(md).toContain("## 活跃文件 Top 10");
    expect(md).toContain("## 终身累计");
    expect(md).toContain("| 1 | 笔记/日记.md | 15,230 |");
  });

  it("精简版不含热力与排行，保留总览/趋势/终身", () => {
    const g = globalStats();
    g.dailyGrossByDate["2026-08-06"] = 100;
    const md = buildMarkdownReport(input(g), { template: "brief", range: 7, now: NOW });
    expect(md).toContain("## 本期总览");
    expect(md).toContain("## 每日趋势");
    expect(md).toContain("## 终身累计");
    expect(md).not.toContain("活跃时段（24 小时热力）");
    expect(md).not.toContain("活跃文件 Top 10");
  });

  it("范围聚合正确：近 7 天累计输入 = 各天之和，峰值取最大值", () => {
    const g = globalStats();
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 7, 6 - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      g.dailyGrossByDate[k] = 1000 + i;
      g.dailyPeakByDate[k] = 50 + i;
    }
    const md = buildMarkdownReport(input(g), { template: "brief", range: 7, now: NOW });
    // 1000..1006 求和 = 7021
    expect(md).toContain("7,021 字");
    expect(md).toContain("1,006"); // 峰值 1006 出现在 08-06
    // 趋势表应含首尾日期标签（07-31 / 08-06）
    expect(md).toContain("| 07-31 |");
    expect(md).toContain("| 08-06 |");
  });

  it("本月范围：从当月 1 日至今天", () => {
    const g = globalStats();
    g.dailyGrossByDate["2026-08-01"] = 500;
    g.dailyGrossByDate["2026-08-06"] = 300;
    // 07-31 属于上个月，不应计入本月范围
    g.dailyGrossByDate["2026-07-31"] = 9999;
    const md = buildMarkdownReport(input(g), { template: "brief", range: "month", now: NOW });
    expect(md).toContain("800 字"); // 500 + 300
    expect(md).not.toContain("9,999");
    // 范围头：08-01 ~ 08-06
    expect(md).toContain("2026-08-01 ~ 2026-08-06");
  });

  it("热力文本方块：相对最大值 5 格，0 值小时跳过", () => {
    const g = globalStats();
    g.heatmap["2026-08-06"] = new Array<number>(24).fill(0);
    g.heatmap["2026-08-06"][9] = 600_000; // 10 分钟（最大值）
    g.heatmap["2026-08-06"][14] = 300_000; // 5 分钟（一半 → 3 格）
    const md = buildMarkdownReport(input(g), { template: "full", range: 7, now: NOW });
    expect(md).toContain("| 09:00 | █████ 10分 |");
    expect(md).toContain("| 14:00 | ███░░ 5分 |");
    // 其余小时 0 值不输出
    expect(md).not.toContain("| 10:00 |");
  });

  it("终身累计：输入/删除/净产出", () => {
    const g = globalStats();
    g.grossTypedTotal = 1_234_567;
    g.deletedCharsTotal = 234_567;
    const md = buildMarkdownReport(input(g), { template: "brief", range: 7, now: NOW });
    expect(md).toContain("1,234,567 字");
    expect(md).toContain("234,567 字");
    expect(md).toContain("1,000,000 字"); // 净产出
  });

  it("heatHourValue：兼容旧 number[] 与新对象结构", () => {
    expect(heatHourValue([1, 2, 3], 1)).toBe(2);
    expect(heatHourValue({ activeMs: [10, 20], grossByHour: [1, 2] }, 0)).toBe(10);
    expect(heatHourValue({ activeMs: [10, 20], grossByHour: [1, 2] }, 5)).toBe(0);
    expect(heatHourValue(undefined, 0)).toBe(0);
  });

  it("topActiveFiles：按指标排序、过滤 0 值、截断取前 N", () => {
    const files = [
      fileStats("a.md", 300, 100),
      fileStats("b.md", 500, 0),
      fileStats("c.md", 100, 400), // net 为 0 → 净字数排行被过滤
    ];
    const byGross = topActiveFiles(files, "gross", 2);
    expect(byGross.map((f) => f.path)).toEqual(["b.md", "a.md"]);
    const byNet = topActiveFiles(files, "net", 10);
    expect(byNet.map((f) => f.path)).toEqual(["b.md", "a.md"]);
  });
});
