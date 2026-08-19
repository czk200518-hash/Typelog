// 编辑器事件追踪：editor-change + 全文 diff 统计变更；
// paste/drop 事件标记粘贴（不计逐字）
import { Editor, Workspace, EventRef, MarkdownFileInfo, MarkdownView, TFile, Vault } from "obsidian";
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

  // 差异区超限：不再继续剥离公共部分，直接以差异区近似（slice 为引用级操作，无内容复制）。
  // 仅统计真实差异区长度，避免把未变化的全文误计为删除+输入（旧实现会虚高当日累计输入）
  if (endOld - start > MAX_DIFF_REGION || endNew - start > MAX_DIFF_REGION) {
    return { removed: oldText.slice(start, endOld), inserted: newText.slice(start, endNew) };
  }

  return {
    removed: oldText.slice(start, endOld),
    inserted: newText.slice(start, endNew),
  };
}

// 缓存上限，防内存膨胀
const MAX_CACHED = 32;
// 粘贴标记有效期（ms）：paste/drop 事件与其后的 editor-change 必须落在该窗口内，
// 超过视为滞留标记（事件未配对），清除以避免后续手动键入被误判为粘贴
const PASTE_TTL_MS = 3000;

export class EditorTracker {
  private editorChangeRef: EventRef | null = null;
  private pasteRef: EventRef | null = null;
  private dropRef: EventRef | null = null;
  private fileOpenRef: EventRef | null = null;
  // 各文件文本快照
  private lastValues = new Map<string, string>();
  // 待消费的粘贴标记（按文件路径 -> 事件时间戳）
  private pastePending = new Map<string, number>();

  constructor(
    private workspace: Workspace,
    private vault: Vault,
    private parseOpts: () => ParseOptions,
    private handlers: EditorTrackerHandlers,
  ) {}

  attach() {
    this.editorChangeRef = this.workspace.on("editor-change", this.handleEditorChange, this);
    this.pasteRef = this.workspace.on("editor-paste", this.handlePaste, this);
    this.dropRef = this.workspace.on("editor-drop", this.handlePaste, this);
    // file-open 预热快照：文件重新打开后首次编辑也能正常 diff，不因快照淘汰而丢统计
    this.fileOpenRef = this.workspace.on("file-open", this.handleFileOpen, this);
  }

  detach() {
    if (this.editorChangeRef) this.workspace.offref(this.editorChangeRef);
    if (this.pasteRef) this.workspace.offref(this.pasteRef);
    if (this.dropRef) this.workspace.offref(this.dropRef);
    if (this.fileOpenRef) this.workspace.offref(this.fileOpenRef);
    this.editorChangeRef = this.pasteRef = this.dropRef = null;
    this.fileOpenRef = null;
    this.lastValues.clear();
    this.pastePending.clear();
  }

  // 文件打开/新建时预热快照。file-open 阶段编辑器通常尚未完成内容加载，
  // 此时 editor.getValue() 会返回空串或上一文件内容；若以其为快照，编辑器异步
  // 载入全文时会触发 editor-change（空串→全文 / 旧内容→全文），被 diffText 判为
  // 大量插入，从而把整篇文档误记入当日累计输入。改用 cachedRead 读磁盘真值预热，
  // 快照与最终编辑器内容一致，载入触发的 editor-change 因 prev===value 不产生 diff。
  private handleFileOpen = (file: TFile | null) => {
    if (!file) return;
    const path = file.path;
    void this.vault
      .cachedRead(file)
      .then((text) => {
        // 仅当尚无快照时写回：期间若已发生真实编辑（editor-change 先建立快照），
        // 以编辑为准，避免异步回写把快照滚回旧内容导致后续 diff 虚增
        if (!this.lastValues.has(path)) {
          this.lastValues.set(path, text);
        }
      })
      .catch(() => {
        // 读取失败（极端环境）：不预热，首次编辑仍会兜底建立快照（prev 为空，不产生 diff）
      });
  };

  // 当前打开的 Markdown 文件路径集合（供快照淘汰策略使用；统计对象均为 md 文件）
  private openPaths(): Set<string> {
    const set = new Set<string>();
    for (const leaf of this.workspace.getLeavesOfType("markdown")) {
      const f = (leaf.view as { file?: TFile | null } | undefined)?.file;
      if (f && f.path) set.add(f.path);
    }
    return set;
  }

  private handlePaste = (_evt: ClipboardEvent | DragEvent, _editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
    if (info.file) this.pastePending.set(info.file.path, Date.now());
  };

  private handleEditorChange = (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
    const path = info.file?.path ?? "";
    const value = editor.getValue();
    const prev = this.lastValues.get(path);
    this.recordValue(path, value);
    this.handlers.onActivity();
    if (prev === undefined) return; // 本文件首次快照（或快照被淘汰后），无法 diff
    if (prev === value) return;
    const diff = diffText(prev, value);
    if (diff.inserted.length === 0 && diff.removed.length === 0) return;
    // 粘贴标记：仅消费窗口内的标记；过期滞留标记清除且不计（防止后续手动键入被误判为粘贴）
    const pasteAt = this.pastePending.get(path);
    let isPaste = false;
    if (pasteAt !== undefined) {
      this.pastePending.delete(path);
      if (Date.now() - pasteAt <= PASTE_TTL_MS) isPaste = true;
    }
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
      // 优先淘汰未打开文件的最旧快照；全部都是打开文件时退化为最旧淘汰。
      // 打开中的文件始终保留快照（配合 file-open 预热），快照淘汰不再造成统计漏计
      const open = this.openPaths();
      let victim: string | undefined;
      for (const k of this.lastValues.keys()) {
        if (!open.has(k)) {
          victim = k;
          break;
        }
      }
      if (victim === undefined) victim = this.lastValues.keys().next().value;
      if (victim !== undefined) this.lastValues.delete(victim);
    }
    this.lastValues.set(path, value);
  }
}
