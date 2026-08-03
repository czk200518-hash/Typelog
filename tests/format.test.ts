// 格式化工具函数测试：默认导出文件名与文件名清洗
import { describe, it, expect } from "vitest";
import { defaultExportName, formatMinutesSeconds, parseMinutesSeconds, safeFileName } from "../src/core/format";

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
});
