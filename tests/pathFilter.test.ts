import { describe, it, expect } from "vitest";
import { compileIgnorePatterns, normalizePath } from "../src/core/pathFilter";

describe("pathFilter .ignore 规则", () => {
  it("排除 node_modules", () => {
    const isEx = compileIgnorePatterns(["node_modules"]);
    expect(isEx("node_modules/pkg/index.js")).toBe(true);
    expect(isEx("src/index.js")).toBe(false);
  });

  it("目录规则匹配深层文件", () => {
    const isEx = compileIgnorePatterns(["node_modules/"]);
    expect(isEx("a/node_modules/b/c.js")).toBe(true);
  });

  it("通配符 *.min.js", () => {
    const isEx = compileIgnorePatterns(["*.min.js"]);
    expect(isEx("dist/app.min.js")).toBe(true);
    expect(isEx("dist/app.js")).toBe(false);
  });

  it("** 跨目录匹配", () => {
    const isEx = compileIgnorePatterns(["**/build/**"]);
    expect(isEx("a/b/build/x/y.js")).toBe(true);
    expect(isEx("a/b/src/y.js")).toBe(false);
  });

  it("! 反向排除优先", () => {
    const isEx = compileIgnorePatterns(["*.js", "!keep.js"]);
    expect(isEx("drop.js")).toBe(true);
    expect(isEx("keep.js")).toBe(false);
  });

  it("# 注释被忽略", () => {
    const isEx = compileIgnorePatterns(["# 注释", "*.tmp"]);
    expect(isEx("a.tmp")).toBe(true);
    expect(isEx("a.txt")).toBe(false);
  });

  it("normalizePath 统一分隔符", () => {
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
    expect(normalizePath("a//b///c")).toBe("a/b/c");
  });

  it("空规则不排除任何文件", () => {
    const isEx = compileIgnorePatterns([]);
    expect(isEx("any/path.md")).toBe(false);
  });
});
