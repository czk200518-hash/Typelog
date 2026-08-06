import { describe, it, expect } from "vitest";
import { SessionStatsStore } from "../src/core/sessionStore";

describe("SessionStatsStore 会话统计", () => {
  it("begin 记录起点净字数（严格模式）", () => {
    const s = new SessionStatsStore();
    s.begin("/v/a.md", "你好 world 插件", "strict", 0);
    const snap = s.get();
    expect(snap?.netStartWords).toBe(5); // 你好(2)+world(1)+插件(2)
  });

  it("applyChange 更新净变化/累计输入/删除", () => {
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

  it("begin 传入当天历史采样：曲线继承且新采样在历史累计上连续（跨会话恢复）", () => {
    const s = new SessionStatsStore();
    // 历史会话：前一日留下的当天采样，最后一点 delta=500、gross=800
    const hist = [
      { t: 1_000, delta: 200, gross: 300 },
      { t: 2_000, delta: 500, gross: 800 },
    ];
    s.begin("/v/a.md", "", "strict", 3_000, { minuteSeries: hist });
    // 继承历史点
    expect(s.get()?.minuteSeries).toEqual(hist);
    // 新会话输入 100 字后采样：delta/gross 在历史基础上累加
    s.applyChange({ typed: 100, deleted: 20, net: 80, isPaste: false, typedManual: 100 });
    s.pushMinuteSample(4_000);
    const series = s.get()!.minuteSeries;
    expect(series.length).toBe(3);
    expect(series[2]).toEqual({ t: 4_000, delta: 580, gross: 900 }); // 500+80 / 800+100
  });

  it("无历史采样时偏移为 0，行为与旧版一致", () => {
    const s = new SessionStatsStore();
    s.begin("/v/a.md", "", "strict", 0);
    s.applyChange({ typed: 10, deleted: 0, net: 10, isPaste: false, typedManual: 10 });
    s.pushMinuteSample(1_000);
    expect(s.get()?.minuteSeries).toEqual([{ t: 1_000, delta: 10, gross: 10 }]);
  });
});
