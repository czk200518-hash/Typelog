// 字数计数：严格=汉字+英文单词；宽松=所有可见字符（忽略空白）
import type { CountMode } from "./settings";

// CJK 统一表意文字（含扩展 A、兼容表意文字）
const CJK_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
// 英文单词：字母数字下划线开头，可含连字符/撇号
const WORD_REGEX = /[A-Za-z0-9_]+(?:['-][A-Za-z0-9_]+)*/g;

// 逐匹配计数：迭代器方式不构建匹配数组（大文本下省内存与 GC）；
// 每次使用独立正则副本，避免共享 lastIndex 引发重入污染
function countMatches(re: RegExp, text: string): number {
  let n = 0;
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const r = new RegExp(re.source, flags);
  // 迭代器方式计数，不构建匹配数组；不声明未使用的循环变量
  const it = text.matchAll(r);
  while (!it.next().done) n++;
  return n;
}

export function countText(text: string, mode: CountMode): number {
  if (!text) return 0;
  if (mode === "loose") {
    // 遍历计数非空白字符，避免 replace 生成中间字符串
    let n = 0;
    const re = /\S/g;
    while (re.exec(text) !== null) n++;
    return n;
  }
  return countMatches(CJK_REGEX, text) + countMatches(WORD_REGEX, text);
}

export function countCJK(text: string): number {
  if (!text) return 0;
  return countMatches(CJK_REGEX, text);
}

export function countWords(text: string): number {
  if (!text) return 0;
  return countMatches(WORD_REGEX, text);
}
