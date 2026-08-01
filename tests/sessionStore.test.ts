import { describe, it, expect } from "vitest";
import { SessionStatsStore } from "../src/core/sessionStore";

describe("SessionStatsStore 会话统计", () => {
  it("begin 记录起点净字数（严格模式）", () => {
    const s = new SessionStatsStore();
    s.begin("/v/a.md", "你好 world 插件", "strict", 0);
    const snap = s.get();
    expect(snap?.netStartWords).toBe(5); // 你好(2)+world(1)+插件(2)
  });

  it("applyChange 更新净变化/毛输入/删除", () => {
    const s = new SessionStatsStore();
    s.begin("/v/a.md", "", "strict", 0);
    s.applyChange({ typed: 10, deleted: 2, net: 8, isPaste: false, typedManual: 10 });
    s.applyChange({ typed: 0, deleted: 5, net: -5, isPaste: false, typedManual: 0 });
    const snap = s.get();
    expect(snap?.deltaWords).toBe(3);
    expect(snap?.grossTyped).toBe(10);
    expect(snap?.deletedChars).toBe(7);
  });

  it("addActiveMs 与 setPeak", () => {
    const s = new SessionStatsStore();
    s.begin("/v/a.md", "", "strict", 0);
    s.addActiveMs(3000);
    s.setPeak(90);
    s.setPeak(60);
    const snap = s.get();
    expect(snap?.activeTimeMs).toBe(3000);
    expect(snap?.peakSpeed).toBe(90);
  });

  it("end 取出快照并清空", () => {
    const s = new SessionStatsStore();
    s.begin("/v/a.md", "", "strict", 0);
    const out = s.end();
    expect(out?.path).toBe("/v/a.md");
    expect(s.get()).toBeNull();
  });

  it("setNetStartWords 校准起点", () => {
    const s = new SessionStatsStore();
    s.begin("/v/a.md", "", "strict", 0);
    s.setNetStartWords("一篇文章的正文内容", "strict");
    expect(s.get()?.netStartWords).toBe(9);
  });
});
