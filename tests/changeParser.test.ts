import { describe, it, expect } from "vitest";
import { parseChange, sumChanges } from "../src/core/changeParser";
import type { ChangeStats } from "../src/types";

const opts = { includePasteInSpeed: false };

describe("parseChange 编辑变更解析", () => {
  it("逐字键入", () => {
    const s = parseChange({ insertedText: "a", removedText: "" }, opts);
    expect(s).toMatchObject({ typed: 1, deleted: 0, net: 1, isPaste: false, typedManual: 1 });
  });
  it("删除字符（Backspace）", () => {
    const s = parseChange({ insertedText: "", removedText: "a" }, opts);
    expect(s).toMatchObject({ typed: 0, deleted: 1, net: -1, isPaste: false, typedManual: 0 });
  });
  it("选中替换：同时计删除与新增", () => {
    const s = parseChange({ insertedText: "new", removedText: "old" }, opts);
    expect(s).toMatchObject({ typed: 3, deleted: 3, net: 0, isPaste: false, typedManual: 3 });
  });
  it("粘贴大段文本：识别为导入，不计逐字", () => {
    const s = parseChange({ insertedText: "x".repeat(100), removedText: "" }, opts);
    expect(s.isPaste).toBe(true);
    expect(s.typedManual).toBe(0);
    expect(s.typed).toBe(100);
  });
  it("粘贴开启时计入逐字", () => {
    const s = parseChange({ insertedText: "x".repeat(100), removedText: "" }, { includePasteInSpeed: true });
    expect(s.isPaste).toBe(true);
    expect(s.typedManual).toBe(100);
  });
  it("中文 IME 一次上屏多字（< 阈值）不算粘贴", () => {
    const s = parseChange({ insertedText: "你好世界", removedText: "" }, opts);
    expect(s.isPaste).toBe(false);
    expect(s.typedManual).toBe(4);
  });
  it("多光标：独立字符数累加", () => {
    const a = parseChange({ insertedText: "ab", removedText: "" }, opts);
    const b = parseChange({ insertedText: "cd", removedText: "" }, opts);
    const total = sumChanges([a, b]);
    expect(total.typed).toBe(4);
    expect(total.typedManual).toBe(4);
  });
});

describe("sumChanges 汇总", () => {
  it("正确累加", () => {
    const list: ChangeStats[] = [
      { typed: 5, deleted: 1, net: 4, isPaste: false, typedManual: 5 },
      { typed: 0, deleted: 2, net: -2, isPaste: false, typedManual: 0 },
    ];
    const s = sumChanges(list);
    expect(s).toMatchObject({ typed: 5, deleted: 3, net: 2, typedManual: 5 });
  });
});
