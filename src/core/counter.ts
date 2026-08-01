// 字数计数：严格=汉字+英文单词；宽松=所有可见字符（忽略空白）
import type { CountMode } from "./settings";

// CJK 统一表意文字（含扩展 A、兼容表意文字）
const CJK_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
// 英文单词：字母数字下划线开头，可含连字符/撇号
const WORD_REGEX = /[A-Za-z0-9_]+(?:['-][A-Za-z0-9_]+)*/g;

export function countText(text: string, mode: CountMode): number {
  if (!text) return 0;
  if (mode === "loose") {
    return text.replace(/\s/g, "").length;
  }
  const cjk = text.match(CJK_REGEX);
  const words = text.match(WORD_REGEX);
  return (cjk ? cjk.length : 0) + (words ? words.length : 0);
}

export function countCJK(text: string): number {
  if (!text) return 0;
  return (text.match(CJK_REGEX) || []).length;
}

export function countWords(text: string): number {
  if (!text) return 0;
  return (text.match(WORD_REGEX) || []).length;
}
