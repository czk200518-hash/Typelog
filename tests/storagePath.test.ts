// 系统路径判断测试：导出到 vault 外绝对路径时走 Node fs 写入
import { describe, it, expect } from "vitest";
import { isSystemPath } from "../src/tracking/storageAdapter";

describe("isSystemPath 系统路径判断", () => {
  it("Windows 盘符路径识别为系统路径", () => {
    expect(isSystemPath("D:\\exports")).toBe(true);
    expect(isSystemPath("D:/exports")).toBe(true);
    expect(isSystemPath("c:\\data\\a.json")).toBe(true);
  });

  it("正斜杠与 UNC 开头识别为系统路径", () => {
    expect(isSystemPath("/vault/data")).toBe(true);
    expect(isSystemPath("\\\\server\\share")).toBe(true);
  });

  it("vault 相对路径不识别为系统路径", () => {
    expect(isSystemPath("typelog-exports")).toBe(false);
    expect(isSystemPath("notes/export")).toBe(false);
    expect(isSystemPath(".typelog/global.json")).toBe(false);
  });
});
