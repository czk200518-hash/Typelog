// 功能 8：设置消毒（statusBarItems 白名单校验）与显示项重排纯函数单测
import { describe, it, expect } from "vitest";
import { sanitizeSettings } from "../src/main";
import { DEFAULT_STATUS_BAR_ITEMS, reorderStatusBarItems, STATUS_BAR_ITEM_IDS } from "../src/core/settings";

describe("sanitizeSettings 状态栏显示项消毒（功能 8）", () => {
  it("合法 statusBarItems 原样采纳（含顺序）", () => {
    const out = sanitizeSettings({
      statusBarItems: [
        { id: "goal", enabled: true },
        { id: "speed", enabled: false },
      ],
    });
    expect(out.statusBarItems).toEqual([
      { id: "goal", enabled: true },
      { id: "speed", enabled: false },
    ]);
  });

  it("非法 id 过滤、重复 id 去重、非 boolean 回退为 true；缺 goal 项自动补齐", () => {
    const out = sanitizeSettings({
      statusBarItems: [
        { id: "hacker-id", enabled: true },
        { id: "speed", enabled: true },
        { id: "speed", enabled: false },
        { id: "wpm", enabled: 1 as unknown as boolean },
      ],
    });
    expect(out.statusBarItems).toEqual([
      { id: "speed", enabled: true },
      { id: "wpm", enabled: true },
      { id: "goal", enabled: true },
    ]);
  });

  it("已含 goal 项时原样保留顺序，不重复补齐", () => {
    const out = sanitizeSettings({
      statusBarItems: [
        { id: "todayGross", enabled: true },
        { id: "goal", enabled: false },
      ],
    });
    expect(out.statusBarItems).toEqual([
      { id: "todayGross", enabled: true },
      { id: "goal", enabled: false },
    ]);
  });

  it("补齐的 goal 项插入在 todayGross 之后", () => {
    const out = sanitizeSettings({
      statusBarItems: [
        { id: "speed", enabled: true },
        { id: "todayGross", enabled: true },
        { id: "pomodoro", enabled: true },
      ],
    });
    expect(out.statusBarItems).toEqual([
      { id: "speed", enabled: true },
      { id: "todayGross", enabled: true },
      { id: "goal", enabled: true },
      { id: "pomodoro", enabled: true },
    ]);
  });

  it("statusBarItems 非数组或过滤后为空 → 不设置（回退默认值）", () => {
    expect(sanitizeSettings({ statusBarItems: "bad" as unknown as never }).statusBarItems).toBeUndefined();
    expect(sanitizeSettings({ statusBarItems: [{ id: "x", enabled: true }] }).statusBarItems).toBeUndefined();
  });

  it("损坏的其他字段不影响 statusBarItems 消毒", () => {
    const out = sanitizeSettings({
      language: "en",
      dailyWordGoal: -5,
      statusBarItems: [{ id: "todayActive", enabled: true }],
    });
    expect(out.language).toBe("en");
    expect(out.dailyWordGoal).toBeUndefined(); // 非法值不采纳
    expect(out.statusBarItems).toEqual([
      { id: "todayActive", enabled: true },
      { id: "goal", enabled: true },
    ]);
  });
});

describe("reorderStatusBarItems 显示项重排（功能 8）", () => {
  it("正常移动：下标互换", () => {
    // 移除 index 0 后插入到 index 2
    expect(reorderStatusBarItems(DEFAULT_STATUS_BAR_ITEMS, 0, 2).map((i) => i.id)).toEqual(["net", "todayGross", "speed", "goal", "pomodoro"]);
  });

  it("首项上移 / 末项下移：边界外返回原数组", () => {
    expect(reorderStatusBarItems(DEFAULT_STATUS_BAR_ITEMS, 0, -1)).toBe(DEFAULT_STATUS_BAR_ITEMS);
    expect(reorderStatusBarItems(DEFAULT_STATUS_BAR_ITEMS, 4, 5)).toBe(DEFAULT_STATUS_BAR_ITEMS);
  });

  it("from === to：返回原数组（引用不变）", () => {
    expect(reorderStatusBarItems(DEFAULT_STATUS_BAR_ITEMS, 1, 1)).toBe(DEFAULT_STATUS_BAR_ITEMS);
  });

  it("不修改原数组", () => {
    const before = DEFAULT_STATUS_BAR_ITEMS.map((i) => i.id);
    reorderStatusBarItems(DEFAULT_STATUS_BAR_ITEMS, 0, 2);
    expect(DEFAULT_STATUS_BAR_ITEMS.map((i) => i.id)).toEqual(before);
  });
});

describe("状态栏显示项常量", () => {
  it("白名单含 8 项且默认值 5 项（含目标进度）", () => {
    expect(STATUS_BAR_ITEM_IDS).toEqual(["speed", "wpm", "net", "todayGross", "todayActive", "goal", "fileGross", "pomodoro"]);
    expect(DEFAULT_STATUS_BAR_ITEMS.map((i) => i.id)).toEqual(["speed", "net", "todayGross", "goal", "pomodoro"]);
    expect(DEFAULT_STATUS_BAR_ITEMS.every((i) => i.enabled)).toBe(true);
  });
});
