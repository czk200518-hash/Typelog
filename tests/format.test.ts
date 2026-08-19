// 格式化工具函数测试：默认导出文件名与文件名清洗
import { describe, it, expect } from "vitest";
import { defaultExportName, formatMinutesSeconds, parseMinutesSeconds, safeFileName, weekKeys, weekSum } from "../src/core/format";

describe("导出文件名工具", () => {
  it("defaultExportName 生成 typelog-YYYY-MM-DD-HHMMSS 格式", () => {
    const d = new Date(2026, 7, 3, 16, 5, 9); // 2026-08-03 16:05:09
    expect(defaultExportName(d)).toBe("typelog-2026-08-03-160509");
  });

  it("safeFileName 将路径分隔符与非法字符替换为连字符", () => {
    expect(safeFileName("a/b\\c:d*e?f\"g<h>i|j")).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("safeFileName 去除首尾空白", () => {
    expect(safeFileName("  报告  ")).toBe("报告");
  });

  it("safeFileName 空字符串返回空串（由调用方兜底）", () => {
    expect(safeFileName("")).toBe("");
  });

  it("safeFileName 纯分隔符输入替换为连字符", () => {
    expect(safeFileName("///")).toBe("---");
  });
});

describe("formatMinutesSeconds 固定 X分Y秒 格式化", () => {
  it("5 秒（0.0833…分钟）显示为 0分5秒", () => {
    expect(formatMinutesSeconds(5 / 60)).toBe("0分5秒");
  });

  it("整分钟显示为 X分0秒", () => {
    expect(formatMinutesSeconds(25)).toBe("25分0秒");
  });

  it("带秒显示为 X分Y秒", () => {
    expect(formatMinutesSeconds(1.5)).toBe("1分30秒");
    expect(formatMinutesSeconds(25.25)).toBe("25分15秒");
  });

  it("不足 1 秒向上取整到秒", () => {
    expect(formatMinutesSeconds(0.5 / 60)).toBe("0分1秒");
  });
});

describe("parseMinutesSeconds 时长输入解析", () => {
  it("纯数字按分钟解析", () => {
    expect(parseMinutesSeconds("25")).toBe(25);
    expect(parseMinutesSeconds("1.5")).toBe(1.5);
  });

  it("X分Y秒 格式解析", () => {
    expect(parseMinutesSeconds("1分30秒")).toBe(1.5);
    expect(parseMinutesSeconds("0分5秒")).toBeCloseTo(5 / 60, 10);
    expect(parseMinutesSeconds("25分0秒")).toBe(25);
  });

  it("X:Y 格式解析", () => {
    expect(parseMinutesSeconds("1:30")).toBe(1.5);
    expect(parseMinutesSeconds("0:05")).toBeCloseTo(5 / 60, 10);
  });

  it("Y秒 格式解析", () => {
    expect(parseMinutesSeconds("5秒")).toBeCloseTo(5 / 60, 10);
  });

  it("非法输入返回 null", () => {
    expect(parseMinutesSeconds("")).toBe(null);
    expect(parseMinutesSeconds("abc")).toBe(null);
    expect(parseMinutesSeconds("1分60秒")).toBe(null);
  });

  it("超过上限（7 天 = 10080 分钟）返回 null，防止溢出", () => {
    expect(parseMinutesSeconds("10080")).toBe(10080); // 边界值合法
    expect(parseMinutesSeconds("10081")).toBe(null);
    expect(parseMinutesSeconds("20000分")).toBe(null);
    expect(parseMinutesSeconds("1e308")).toBe(null);
  });
});

describe("weekKeys / weekSum 周聚合（功能 7）", () => {
  // 2026-08-06 是周四，本周一为 08-03，周日为 08-09
  const THU = new Date(2026, 7, 6, 14, 30);

  it("weekKeys：周一至周日（含周日）", () => {
    expect(weekKeys(THU)).toEqual(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"]);
  });

  it("周一当天：本周从当天开始", () => {
    const MON = new Date(2026, 7, 3);
    expect(weekKeys(MON)[0]).toBe("2026-08-03");
    expect(weekKeys(MON)[6]).toBe("2026-08-09");
  });

  it("周日当天：本周仍从周一算起", () => {
    const SUN = new Date(2026, 7, 9);
    expect(weekKeys(SUN)[0]).toBe("2026-08-03");
    expect(weekKeys(SUN)[6]).toBe("2026-08-09");
  });

  it("weekSum：只累计本周键，跨周数据不计入", () => {
    const map: Record<string, number> = {
      "2026-08-03": 100,
      "2026-08-06": 50,
      "2026-08-09": 30,
      // 上周日与下周一分界数据不应计入
      "2026-08-02": 9999,
      "2026-08-10": 9999,
    };
    expect(weekSum(map, THU)).toBe(180);
  });
});
