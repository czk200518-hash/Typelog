// 编辑变更解析：一次编辑拆出新增/删除字符数
// typed 含粘贴；单次插入超阈值判为批量导入
import type { ChangeStats } from "../types";

// 粘贴判定阈值：单次插入 >= 该值视为批量导入
export const PASTE_THRESHOLD = 10;

// 原始编辑变更（由编辑器层转换而来）
export interface RawChange {
  insertedText: string;
  removedText: string;
}

export interface ParseOptions {
  // 是否将粘贴内容计入逐字键入速度
  includePasteInSpeed: boolean;
  // 粘贴判定阈值
  pasteThreshold?: number;
  // 强制标记为粘贴（由 editor-paste/editor-drop 事件驱动）
  forcePaste?: boolean;
}

export function parseChange(raw: RawChange, opts: ParseOptions): ChangeStats {
  const threshold = opts.pasteThreshold ?? PASTE_THRESHOLD;
  const insertedLen = raw.insertedText.length;
  const deletedLen = raw.removedText.length;
  const isPaste = !!opts.forcePaste || insertedLen >= threshold;
  let typedManual: number;
  if (isPaste) {
    typedManual = opts.includePasteInSpeed ? insertedLen : 0;
  } else {
    typedManual = insertedLen;
  }
  return {
    typed: insertedLen,
    deleted: deletedLen,
    net: insertedLen - deletedLen,
    isPaste,
    typedManual,
  };
}

export function sumChanges(list: ChangeStats[]): ChangeStats {
  const out: ChangeStats = { typed: 0, deleted: 0, net: 0, isPaste: false, typedManual: 0 };
  for (const c of list) {
    out.typed += c.typed;
    out.deleted += c.deleted;
    out.net += c.net;
    out.typedManual += c.typedManual;
    if (c.isPaste) out.isPaste = true;
  }
  return out;
}
