import { describe, it, expect } from "vitest";
import { SpeedTracker } from "../src/core/speedTracker";

describe("SpeedTracker 滑动窗口速度", () => {
  it("CPM 基于 60s 窗口", () => {
    const t = new SpeedTracker();
    for (let i = 0; i < 10; i++) t.addChars(5, i * 1000); // 10 秒内 50 字符
    expect(t.cpm(10_000)).toBe(50);
  });

  it("60s 外的事件被淘汰", () => {
    const t = new SpeedTracker();
    t.addChars(100, 0);
    expect(t.cpm(0)).toBe(100);
    expect(t.cpm(61_000)).toBe(0);
  });

  it("WPM = CPM / 5", () => {
    const t = new SpeedTracker();
    t.addChars(25, 0);
    expect(t.wpm(0)).toBe(5);
  });

  it("峰值取 10s 窗口最高 CPM", () => {
    const t = new SpeedTracker();
    t.addChars(50, 0); // 10s 窗口内 50 CPM
    t.addChars(0, 10_000);
    t.addChars(100, 20_000); // 20s 时 10s 窗口内 100 CPM
    expect(t.getPeak()).toBeGreaterThanOrEqual(100);
  });

  it("reset 清空", () => {
    const t = new SpeedTracker();
    t.addChars(50, 0);
    t.reset();
    expect(t.cpm(0)).toBe(0);
    expect(t.getPeak()).toBe(0);
  });
});
