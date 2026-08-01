import { describe, it, expect } from "vitest";
import { ActiveStateMachine } from "../src/core/activeMachine";

describe("ActiveStateMachine 活跃/闲置状态机", () => {
  const THRESHOLD = 5000; // 5 秒

  it("阈值内视为活跃", () => {
    const m = new ActiveStateMachine(THRESHOLD);
    m.start(0);
    m.notifyActivity(1000);
    const res = m.tick(2000, true);
    expect(res).toEqual({ active: true, activeMs: 1000, idleMs: 0 });
  });

  it("超过阈值视为闲置", () => {
    const m = new ActiveStateMachine(THRESHOLD);
    m.start(0);
    m.notifyActivity(1000);
    const res = m.tick(7000, true); // 距最近活动 6000ms > 5000ms
    expect(res.active).toBe(false);
    expect(res.activeMs).toBe(0);
    expect(res.idleMs).toBe(1000);
  });

  it("后台文件不计活跃", () => {
    const m = new ActiveStateMachine(THRESHOLD);
    m.start(0);
    m.notifyActivity(1000);
    const res = m.tick(2000, false);
    expect(res.active).toBe(false);
  });

  it("活动可刷新阈值窗口", () => {
    const m = new ActiveStateMachine(THRESHOLD);
    m.start(0);
    m.notifyActivity(1000);
    m.tick(2000, true);
    m.notifyActivity(6000);
    const res = m.tick(7000, true); // 距 6000 为 1000ms
    expect(res.active).toBe(true);
  });

  it("活跃时长累加", () => {
    const m = new ActiveStateMachine(THRESHOLD);
    m.start(0);
    m.notifyActivity(0);
    m.tick(1000, true);
    m.tick(2000, true);
    m.tick(3000, true);
    expect(m.getActiveMs()).toBe(3000);
    expect(m.getIdleMs(5000)).toBe(2000);
    expect(m.getSessionSpanMs(5000)).toBe(5000);
  });

  it("阈值可动态更新", () => {
    const m = new ActiveStateMachine(1000);
    m.setIdleThresholdMs(8000);
    m.start(0);
    m.notifyActivity(1000);
    const res = m.tick(5000, true); // 4000ms < 8000ms
    expect(res.active).toBe(true);
  });
});
