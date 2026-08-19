// EditorTracker 快照管理测试：缓存淘汰策略（打开文件优先保留）、
// file-open 预热（被淘汰文件重新打开后首次编辑不丢统计）、paste 标记 TTL。
import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorTracker } from "../src/tracking/editorTracker";
import type { ChangeStats } from "../src/types";

// ---- 轻量 mock：Workspace 事件注册 + 编辑器内容 ----
interface MockEditor {
  getValue(): string;
  setText(t: string): void;
}

function makeEditor(initial: string): MockEditor {
  let text = initial;
  return { getValue: () => text, setText: (t: string) => { text = t; } };
}

function createEnv(openFiles: string[] = []) {
  const listeners = new Map<string, (this: unknown, ...args: unknown[]) => void>();
  let activeView: { file: { path: string }; editor: MockEditor } | null = null;
  const workspace = {
    on(event: string, cb: (this: unknown, ...args: unknown[]) => void) {
      listeners.set(event, cb);
      return { event };
    },
    offref() {},
    getActiveViewOfType() {
      return activeView;
    },
    getLeavesOfType() {
      return openFiles.map((p) => ({ view: { file: { path: p } } }));
    },
    // ---- 测试辅助 ----
    emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.apply(null, args);
    },
    setActiveView(v: { file: { path: string }; editor: MockEditor } | null) {
      activeView = v;
    },
  };
  return workspace;
}

// 模拟一次编辑器变更（同一 editor 内文本已更新）
function edit(ws: ReturnType<typeof createEnv>, path: string, editor: MockEditor) {
  ws.emit("editor-change", editor, { file: { path } });
}

function setup(openFiles: string[], diskContents: Map<string, string> = new Map()) {
  const ws = createEnv(openFiles);
  const onChanges = vi.fn();
  const onActivity = vi.fn();
  // 磁盘真值：file-open 预热用 cachedRead 读取（新签名注入 vault）
  const vault = {
    cachedRead: (file: { path: string }) => Promise.resolve(diskContents.get(file.path) ?? ""),
  };
  const tracker = new EditorTracker(
    ws as never,
    vault as never,
    () => ({ includePasteInSpeed: false }),
    { onChanges, onActivity },
  );
  tracker.attach();
  return { ws, tracker, onChanges };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("EditorTracker 快照缓存", () => {
  it("缓存满时优先淘汰未打开文件，打开中的文件快照保留", () => {
    const open = ["f1.md", "f2.md"];
    const { ws, onChanges } = setup(open);
    const editors = new Map<string, MockEditor>();
    for (let i = 1; i <= 32; i++) {
      const p = `f${i}.md`;
      editors.set(p, makeEditor("a"));
      edit(ws, p, editors.get(p)!); // 建立快照（首次无 diff）
    }
    // 第 33 个文件触发淘汰：应淘汰未打开的最旧快照 f3
    edit(ws, "f33.md", makeEditor("a"));

    // 打开中的 f1：快照仍在，二次编辑可正常 diff（不丢统计）
    const f1 = editors.get("f1.md")!;
    f1.setText("ab");
    edit(ws, "f1.md", f1);
    expect(onChanges).toHaveBeenCalledTimes(1);
    expect((onChanges.mock.calls[0][0] as ChangeStats).typed).toBe(1);

    // 未打开的 f3：快照已被淘汰，再次编辑无法 diff（本次变更不计，由 file-open 预热兜底）
    onChanges.mockClear();
    const f3 = editors.get("f3.md")!;
    f3.setText("ab");
    edit(ws, "f3.md", f3);
    expect(onChanges).not.toHaveBeenCalled();
  });

  it("file-open 预热快照：被淘汰的文件重新打开后首次编辑不丢统计", async () => {
    const open = ["f1.md", "f2.md"];
    const disk = new Map<string, string>();
    const { ws, onChanges } = setup(open, disk);
    const editors = new Map<string, MockEditor>();
    for (let i = 1; i <= 32; i++) {
      const p = `f${i}.md`;
      editors.set(p, makeEditor("a"));
      disk.set(p, "a");
      edit(ws, p, editors.get(p)!);
    }
    edit(ws, "f33.md", makeEditor("a")); // 淘汰 f3 快照

    // 重新打开 f3：用磁盘真值（cachedRead）预热快照
    const f3 = editors.get("f3.md")!;
    ws.setActiveView({ file: { path: "f3.md" }, editor: f3 });
    ws.emit("file-open", { path: "f3.md" });
    await new Promise((r) => setTimeout(r, 0)); // 等 cachedRead 预热写入

    // 首次编辑即可正常 diff
    f3.setText("ab");
    edit(ws, "f3.md", f3);
    expect(onChanges).toHaveBeenCalledTimes(1);
    expect((onChanges.mock.calls[0][0] as ChangeStats).typed).toBe(1);
  });

  it("打开已存在的文档：全文载入不计为输入（回归：新文档全文被误计为当日输入）", async () => {
    const disk = new Map<string, string>([["doc.md", "hello world，这是一段已有正文。"]]);
    const { ws, onChanges } = setup([], disk);
    // file-open 时编辑器尚未加载（内容为空），随后异步载入全文会触发 editor-change
    const editor = makeEditor("");
    ws.emit("file-open", { path: "doc.md" });
    await new Promise((r) => setTimeout(r, 0)); // cachedRead 读取磁盘全文并预热快照

    editor.setText("hello world，这是一段已有正文。");
    edit(ws, "doc.md", editor); // 载入全文
    expect(onChanges).not.toHaveBeenCalled(); // 不应把既有正文计为输入

    // 之后用户真正键入才计数
    editor.setText("hello world，这是一段已有正文。新");
    edit(ws, "doc.md", editor);
    expect(onChanges).toHaveBeenCalledTimes(1);
    expect((onChanges.mock.calls[0][0] as ChangeStats).typed).toBe(1);
  });
});

describe("EditorTracker paste 标记", () => {
  it("paste 事件后窗口内的编辑计为粘贴（不计逐字）", () => {
    const { ws, onChanges } = setup([]);
    const editor = makeEditor("a");
    edit(ws, "p.md", editor); // 首次建立快照
    ws.emit("editor-paste", {}, editor, { file: { path: "p.md" } });
    editor.setText("abcdef");
    edit(ws, "p.md", editor);
    expect(onChanges).toHaveBeenCalledTimes(1);
    const stats = onChanges.mock.calls[0][0] as ChangeStats;
    expect(stats.isPaste).toBe(true);
    expect(stats.typedManual).toBe(0); // includePasteInSpeed=false：粘贴不计入速度
  });

  it("paste 标记过期（超过 TTL）后手动键入不被误判为粘贴", () => {
    vi.useFakeTimers();
    const { ws, onChanges } = setup([]);
    const editor = makeEditor("a");
    edit(ws, "p.md", editor); // 首次建立快照
    // 滞留标记：paste 事件后 change 未及时到达（如非 md 编辑器），标记残留
    ws.emit("editor-paste", {}, editor, { file: { path: "p.md" } });
    vi.advanceTimersByTime(4000);
    editor.setText("abcd");
    edit(ws, "p.md", editor);
    expect(onChanges).toHaveBeenCalledTimes(1);
    const stats = onChanges.mock.calls[0][0] as ChangeStats;
    expect(stats.isPaste).toBe(false);
    expect(stats.typedManual).toBe(3); // 按逐字键入计入速度
  });

  it("过期标记被消费清除：后续编辑不再受其影响", () => {
    vi.useFakeTimers();
    const { ws, onChanges } = setup([]);
    const editor = makeEditor("a");
    edit(ws, "p.md", editor);
    ws.emit("editor-paste", {}, editor, { file: { path: "p.md" } });
    vi.advanceTimersByTime(4000);
    editor.setText("abcd");
    edit(ws, "p.md", editor); // 过期：清除标记，按逐字
    onChanges.mockClear();
    editor.setText("abcde");
    edit(ws, "p.md", editor); // 无标记残留：仍按逐字
    const stats = onChanges.mock.calls[0][0] as ChangeStats;
    expect(stats.isPaste).toBe(false);
    expect(stats.typedManual).toBe(1);
  });
});
