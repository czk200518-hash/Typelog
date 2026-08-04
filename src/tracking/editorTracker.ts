// 编辑器事件追踪：editor-change + 全文 diff 统计变更；
// paste/drop 事件标记粘贴（不计逐字）
import { Editor, Workspace, EventRef, MarkdownFileInfo, MarkdownView } from "obsidian";
import type { ChangeStats } from "../types";
import { parseChange, ParseOptions } from "../core/changeParser";

export interface EditorTrackerHandlers {
  // 每次解析出有效变更时回调
  onChanges: (stats: ChangeStats) => void;
  // 任何编辑活动回调（刷新活跃状态用）
  onActivity: () => void;
}

// diff 结果
export interface DiffResult {
  inserted: string;
  removed: string;
}

// 分块粗扫的块大小（2 的幂，块边界对齐便于切片比较）
const DIFF_BLOCK = 256;
// 变更区长度上限：超过后放弃前后缀剥离，以全文近似。
// 仅超大替换/粘贴（>64KB 净变化，击键不可能达到）触发，统计口径不变
const MAX_DIFF_REGION = 64 * 1024;

// 轻量全文 diff：剥离公共前缀/后缀，中间段即变更区。
// 两段式扫描：按 256 字符块整块 slice 比较跳过相同块，块内残余逐字符精扫，
// 大文件（数百 KB）头部/中部编辑时字符操作数降低 1-2 个数量级
export function diffText(oldText: string, newText: string): DiffResult {
  const oldLen = oldText.length;
  const newLen = newText.length;

  // 前缀：粗扫（整块相同直接跳过）+ 精扫（块边界残余逐字符）
  let start = 0;
  while (
    start + DIFF_BLOCK <= oldLen &&
    start + DIFF_BLOCK <= newLen &&
    oldText.slice(start, start + DIFF_BLOCK) === newText.slice(start, start + DIFF_BLOCK)
  ) {
    start += DIFF_BLOCK;
  }
  while (start < oldLen && start < newLen && oldText[start] === newText[start]) start++;

  // 后缀：同样按块粗扫 + 逐字符精扫
  let endOld = oldLen;
  let endNew = newLen;
  while (
    endOld - DIFF_BLOCK >= start &&
    endNew - DIFF_BLOCK >= start &&
    oldText.slice(endOld - DIFF_BLOCK, endOld) === newText.slice(endNew - DIFF_BLOCK, endNew)
  ) {
    endOld -= DIFF_BLOCK;
    endNew -= DIFF_BLOCK;
  }
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }

  // 差异区超限：不再剥离公共部分，直接以全文近似（避免大变更时的二次 O(N) 扫描）
  if (endOld - start > MAX_DIFF_REGION || endNew - start > MAX_DIFF_REGION) {
    return { removed: oldText, inserted: newText };
  }

  return {
    removed: oldText.slice(start, endOld),
    inserted: newText.slice(start, endNew),
  };
}

// 缓存上限，防内存膨胀
const MAX_CACHED = 12;

export class EditorTracker {
  private editorChangeRef: EventRef | null = null;
  private pasteRef: EventRef | null = null;
  private dropRef: EventRef | null = null;
  // 各文件文本快照
  private lastValues = new Map<string, string>();
  // 待消费的粘贴标记（按文件路径）
  private pastePending = new Map<string, boolean>();

  constructor(
    private workspace: Workspace,
    private parseOpts: () => ParseOptions,
    private handlers: EditorTrackerHandlers,
  ) {}

  attach() {
    this.editorChangeRef = this.workspace.on("editor-change", this.handleEditorChange, this);
    this.pasteRef = this.workspace.on("editor-paste", this.handlePaste, this);
    this.dropRef = this.workspace.on("editor-drop", this.handlePaste, this);
  }

  detach() {
    if (this.editorChangeRef) this.workspace.offref(this.editorChangeRef);
    if (this.pasteRef) this.workspace.offref(this.pasteRef);
    if (this.dropRef) this.workspace.offref(this.dropRef);
    this.editorChangeRef = this.pasteRef = this.dropRef = null;
    this.lastValues.clear();
    this.pastePending.clear();
  }

  private handlePaste = (_evt: ClipboardEvent | DragEvent, _editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
    if (info.file) this.pastePending.set(info.file.path, true);
  };

  private handleEditorChange = (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
    const path = info.file?.path ?? "";
    const value = editor.getValue();
    const prev = this.lastValues.get(path);
    this.recordValue(path, value);
    this.handlers.onActivity();
    if (prev === undefined) return; // 本文件首次快照，无法 diff
    if (prev === value) return;
    const diff = diffText(prev, value);
    if (diff.inserted.length === 0 && diff.removed.length === 0) return;
    const isPaste = this.pastePending.get(path) === true;
    this.pastePending.delete(path);
    const stats = parseChange(
      { insertedText: diff.inserted, removedText: diff.removed },
      { ...this.parseOpts(), forcePaste: isPaste },
    );
    if (stats.typed > 0 || stats.deleted > 0) {
      this.handlers.onChanges(stats);
    }
  };

  private recordValue(path: string, value: string) {
    if (!this.lastValues.has(path) && this.lastValues.size >= MAX_CACHED) {
      // FIFO：仅淘汰最久未编辑的快照，而非清空全部。
      // 原清空实现会导致被清掉快照的文件下次首次编辑因无法 diff 而丢失统计
      const oldest = this.lastValues.keys().next().value;
      if (oldest !== undefined) this.lastValues.delete(oldest);
    }
    this.lastValues.set(path, value);
  }
}
