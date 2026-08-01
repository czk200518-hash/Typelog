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
});
