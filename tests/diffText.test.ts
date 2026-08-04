import { describe, it, expect } from "vitest";
import { diffText } from "../src/tracking/editorTracker";

describe("diffText 全文 diff", () => {
  it("插入文本", () => {
    const d = diffText("你好世界", "你好美丽世界");
    expect(d.inserted).toBe("美丽");
    expect(d.removed).toBe("");
  });

  it("删除文本", () => {
    const d = diffText("你好美丽世界", "你好世界");
    expect(d.inserted).toBe("");
    expect(d.removed).toBe("美丽");
  });

  it("选中替换", () => {
    const d = diffText("abc old xyz", "abc new xyz");
    expect(d.removed).toBe("old");
    expect(d.inserted).toBe("new");
  });

  it("首尾变化", () => {
    const d = diffText("hello", "hello world!");
    expect(d.inserted).toBe(" world!");
    expect(d.removed).toBe("");
  });

  it("文本无变化", () => {
    const d = diffText("same", "same");
    expect(d.inserted).toBe("");
    expect(d.removed).toBe("");
  });

  it("整体替换", () => {
    const d = diffText("aaaa", "bbbb");
    expect(d.removed).toBe("aaaa");
    expect(d.inserted).toBe("bbbb");
  });

  it("空文本到文本", () => {
    const d = diffText("", "abc");
    expect(d.inserted).toBe("abc");
    expect(d.removed).toBe("");
  });

  it("差异恰好在 256 块边界", () => {
    const prefix = "a".repeat(256);
    const d = diffText(prefix + "old-tail", prefix + "new-tail");
    expect(d.removed).toBe("old");
    expect(d.inserted).toBe("new");
  });

  it("大文本中部编辑（跨块边界）", () => {
    const prefix = "a".repeat(300);
    const suffix = "b".repeat(300);
    const d = diffText(prefix + "OLD" + suffix, prefix + "NEW" + suffix);
    expect(d.removed).toBe("OLD");
    expect(d.inserted).toBe("NEW");
  });

  it("大文本尾部编辑：公共前缀整块跳过", () => {
    const body = "x".repeat(3000);
    const d = diffText(body + "end-old", body + "end-new");
    expect(d.removed).toBe("old");
    expect(d.inserted).toBe("new");
  });

  it("大文本头部编辑：公共后缀整块跳过", () => {
    const body = "x".repeat(3000);
    const d = diffText("head-old" + body, "head-new" + body);
    expect(d.removed).toBe("old");
    expect(d.inserted).toBe("new");
  });

  it("大文本逐块替换（前后缀均超块）", () => {
    const prefix = "a".repeat(1000);
    const suffix = "b".repeat(1000);
    const midOld = "c".repeat(1000);
    const midNew = "d".repeat(1000);
    const d = diffText(prefix + midOld + suffix, prefix + midNew + suffix);
    expect(d.removed).toBe(midOld);
    expect(d.inserted).toBe(midNew);
  });

  it("差异区超过 64KB：全文近似（统计口径不变）", () => {
    const big = "x".repeat(70 * 1024);
    const oldText = "head" + big + "tail";
    const newText = "head" + "tail";
    const d = diffText(oldText, newText);
    expect(d.removed).toBe(oldText);
    expect(d.inserted).toBe(newText);
  });
});
