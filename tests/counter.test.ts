import { describe, it, expect } from "vitest";
import { countText, countCJK, countWords } from "../src/core/counter";

describe("countText 严格模式（汉字+英文单词）", () => {
  it("纯汉字", () => {
    expect(countText("你好世界", "strict")).toBe(4);
  });
  it("纯英文单词", () => {
    expect(countText("hello world obsidian", "strict")).toBe(3);
  });
  it("中英混合", () => {
    expect(countText("你好 world 插件", "strict")).toBe(5); // 你好(2)+world(1)+插件(2)
  });
  it("忽略标点与空白", () => {
    expect(countText("你好，世界！ hello, world!\n 换行", "strict")).toBe(8); // 2+2+1+1+2
  });
  it("带连字符单词算一个", () => {
    expect(countText("well-known state-of-the-art", "strict")).toBe(2);
  });
  it("空串", () => {
    expect(countText("", "strict")).toBe(0);
  });
});

describe("countText 宽松模式（所有可见字符）", () => {
  it("包含符号", () => {
    expect(countText("你好，世界！", "loose")).toBe(6);
  });
  it("忽略空白", () => {
    expect(countText("a b\tc\n", "loose")).toBe(3);
  });
});

describe("countCJK / countWords", () => {
  it("汉字计数", () => {
    expect(countCJK("中文abc测试")).toBe(4);
  });
  it("单词计数", () => {
    expect(countWords("one two-three 中文")).toBe(2);
  });
});
