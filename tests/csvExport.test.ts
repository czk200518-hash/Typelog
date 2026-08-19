// 优化 2：CSV 多区块导出单测（转义、区块分隔、24 列宽表行、长表跳过 0 值小时）
import { describe, it, expect } from "vitest";
import { buildCsvExport, csvField, sortedDateKeys } from "../src/core/csvExport";
import type { FileStats, GlobalStats } from "../src/types";

function fileStats(path: string, grossTyped: number): FileStats {
  return { path, grossTyped, deletedChars: 0, activeTimeMs: 0, firstSeen: 1, lastOpened: 2 };
}

function globalStats(): GlobalStats {
  const heat = new Array<number>(24).fill(0);
  heat[13] = 60_000;
  heat[14] = 180_000;
  return {
    grossTypedTotal: 15030,
    deletedCharsTotal: 431,
    dailyActiveByDate: { "2026-08-05": 2_400_000, "2026-08-06": 900_000 },
    dailyGrossByDate: { "2026-08-05": 9820, "2026-08-06": 5210 },
    dailyPeakByDate: { "2026-08-05": 78, "2026-08-06": 65 },
    heatmap: { "2026-08-06": heat },
  };
}

describe("优化 2：CSV 多区块导出", () => {
  it("csvField 转义：逗号/引号包裹、公式前缀加引号", () => {
    expect(csvField("普通,路径")).toBe('"普通,路径"');
    expect(csvField('含"引号"')).toBe('"含""引号"""');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("正常文本")).toBe("正常文本");
  });

  it("csvField 公式注入防护：制表符/回车前缀同样前置单引号", () => {
    expect(csvField("\t=1+1")).toBe("'\t=1+1");
    expect(csvField("\r=cmd")).toBe("\"'\r=cmd\"");
    expect(csvField("-=sum")).toBe("'-=sum");
  });

  it("全部内容：四区块齐全，区块头以 # 注释（防公式注入）", () => {
    const csv = buildCsvExport(globalStats(), [fileStats("笔记/日记.md", 15230)], "all");
    const lines = csv.split("\n");
    // BOM 开头
    expect(lines[0].charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("# 文件级统计");
    expect(csv).toContain("# 每日统计");
    expect(csv).toContain("# 每日热力图（宽表）");
    expect(csv).toContain("# 每日热力图（长表）");
    // 文件级行含路径（vault 相对路径，无需转义）
    expect(csv).toContain("笔记/日记.md,15230,0,0,1,2");
  });

  it("宽表：每日期一行 25 列（date + h0..h23），缺失小时补 0", () => {
    const csv = buildCsvExport(globalStats(), [], "all");
    const wideIdx = csv.indexOf("# 每日热力图（宽表）");
    const wideBlock = csv.slice(wideIdx);
    const lines = wideBlock.split("\n");
    expect(lines[1]).toBe("date,h0,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12,h13,h14,h15,h16,h17,h18,h19,h20,h21,h22,h23");
    // 数据行：08-05 无热力图数据（全 0），08-06 有 h13=60s/h14=180s
    const row05 = lines[2].split(",");
    expect(row05.length).toBe(25);
    expect(row05[0]).toBe("2026-08-05");
    expect(row05[1]).toBe("0");
    const row06 = lines[3].split(",");
    expect(row06[0]).toBe("2026-08-06");
    expect(row06[14]).toBe("60000"); // h13 = 60s
  });

  it("长表：仅非零小时输出，行数为非零小时数", () => {
    const csv = buildCsvExport(globalStats(), [], "all");
    const longIdx = csv.indexOf("# 每日热力图（长表）");
    const longBlock = csv.slice(longIdx);
    const rows = longBlock.trim().split("\n").slice(2); // 去掉 # 注释行与表头
    expect(rows).toContain("2026-08-06,13,60000");
    expect(rows).toContain("2026-08-06,14,180000");
    expect(rows.length).toBe(2); // 仅两个非零小时
    expect(rows.every((r) => !r.endsWith(",0"))).toBe(true);
  });

  it("仅文件级：只输出区块 A，不含每日/热力区块", () => {
    const csv = buildCsvExport(globalStats(), [fileStats("a.md", 10)], "files");
    expect(csv).toContain("# 文件级统计");
    expect(csv).toContain("a.md,10,0,0,1,2");
    expect(csv).not.toContain("# 每日统计");
    expect(csv).not.toContain("热力图");
  });

  it("sortedDateKeys：daily*/heatmap 并集升序", () => {
    const g = globalStats();
    g.dailyPeakByDate["2026-08-04"] = 10;
    const keys = sortedDateKeys(g);
    expect(keys).toEqual(["2026-08-04", "2026-08-05", "2026-08-06"]);
  });
});
