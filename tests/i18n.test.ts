import { describe, it, expect, vi, afterEach } from "vitest";
import { t, setLang, getLang, onLangChange, zh, en } from "../src/core/i18n";

describe("i18n 国际化", () => {
  afterEach(() => {
    // 恢复默认语言，避免影响其他测试（formatDuration 依赖当前语言）
    setLang("zh");
  });

  it("默认语言为中文", () => {
    expect(getLang()).toBe("zh");
    expect(t("brand.name")).toBe("TypeLog 字迹");
    expect(t("dash.todayOverview")).toBe("今日总览");
  });

  it("切换英文后返回英文文案", () => {
    setLang("en");
    expect(getLang()).toBe("en");
    expect(t("brand.name")).toBe("TypeLog");
    expect(t("dash.todayOverview")).toBe("Today");
  });

  it("变量替换", () => {
    expect(t("sb.today", { n: "1,234" })).toBe("今日1,234");
    setLang("en");
    expect(t("sb.today", { n: "1,234" })).toBe("Today 1,234");
  });

  it("缺失 key 返回 key 原文", () => {
    setLang("en");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("onLangChange 订阅与取消订阅", () => {
    const cb = vi.fn();
    const off = onLangChange(cb);
    setLang("en");
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    setLang("zh");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("中英文资源 key 完全一致（无遗漏翻译）", () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });
});
