// TypeLog 插件设置

// 计数模式
export type CountMode = "strict" | "loose";

// 统计窗口模式
export type WindowMode = "none" | "sidebar" | "floating";

// 番茄钟计时方式：real=纯计时（启动后按真实时间流逝，不依赖打字）；active=仅活跃时计时
export type PomodoroMode = "real" | "active";

// 界面语言
export type UiLang = "zh" | "en";

// 状态栏显示项 ID（功能 8）：8 项全量可选
export type StatusBarItemId = "speed" | "wpm" | "net" | "todayGross" | "todayActive" | "goal" | "fileGross" | "pomodoro";

// 状态栏显示项配置：有序数组，顺序即显示顺序
export interface StatusBarItemConfig {
  id: StatusBarItemId;
  enabled: boolean;
}

// 全量合法 ID 白名单（设置消毒用）
export const STATUS_BAR_ITEM_IDS: StatusBarItemId[] = ["speed", "wpm", "net", "todayGross", "todayActive", "goal", "fileGross", "pomodoro"];

// 默认显示项：在 v1.0.7 现状（速度 | 净字数 | 今日总输入 | 番茄钟）基础上默认启用「目标进度」，
// 老用户设置文件缺 goal 项时由 sanitizeSettings 自动补齐（见 main.ts）
export const DEFAULT_STATUS_BAR_ITEMS: StatusBarItemConfig[] = [
  { id: "speed", enabled: true },
  { id: "net", enabled: true },
  { id: "todayGross", enabled: true },
  { id: "goal", enabled: true },
  { id: "pomodoro", enabled: true },
];

// 重排状态栏显示项数组（功能 8 拖拽/按钮共用；边界外返回原数组）
export function reorderStatusBarItems(items: StatusBarItemConfig[], from: number, to: number): StatusBarItemConfig[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export interface TypeLogSettings {
  // 界面语言（默认中文，切换后立即生效并持久化）
  language: UiLang;
  // strict=仅汉字与英文单词；loose=所有可见字符
  countMode: CountMode;
  // 粘贴/拖拽内容是否计入打字速度
  includePasteInSpeed: boolean;
  // 闲置判定时间（秒），超过则停止活跃计时
  idleThresholdSec: number;
  // 排除文件/文件夹规则（.ignore 语法）
  excludePatterns: string[];
  // 今日目标字数
  dailyWordGoal: number;
  // 今日目标时长（分钟）
  dailyTimeGoalMin: number;
  // 周目标字数（功能 7，0=不启用）
  weeklyWordGoal: number;
  // 周目标时长（分钟，0=不启用）
  weeklyTimeGoalMin: number;
  // 每日目标达成时弹出通知（功能 5，每天一次）
  goalNotify: boolean;
  // 番茄钟提醒开关
  pomodoroEnabled: boolean;
  // 番茄钟时长（分钟）
  pomodoroMinutes: number;
  // 番茄钟计时方式：real=纯计时；active=仅活跃时计时
  pomodoroMode: PomodoroMode;
  // 
  showStatusBar: boolean;
  // none=不显示窗口；sidebar=侧边栏面板；floating=悬浮窗
  windowMode: WindowMode;
  // 悬浮窗置顶
  popoutAlwaysOnTop: boolean;
  // 数据清理：清理超过 N 天未访问的文件统计（0=不清理）
  purgeInactiveDays: number;
  // 数据清理：每日统计（daily*/heatmap）仅保留最近 N 天（0=不清理）
  dailyRetentionDays: number;
  // 状态栏显示项（功能 8）：有序数组，顺序即显示顺序
  statusBarItems: StatusBarItemConfig[];
}

export const DEFAULT_SETTINGS: TypeLogSettings = {
  language: "zh",
  countMode: "strict",
  includePasteInSpeed: false,
  idleThresholdSec: 5,
  excludePatterns: ["node_modules/**", "*.min.js"],
  dailyWordGoal: 2000,
  dailyTimeGoalMin: 120,
  // 周目标默认不启用（用户按需设置）
  weeklyWordGoal: 0,
  weeklyTimeGoalMin: 0,
  goalNotify: true,
  pomodoroEnabled: true,
  pomodoroMinutes: 25,
  pomodoroMode: "active",
  showStatusBar: true,
  windowMode: "sidebar",
  popoutAlwaysOnTop: true,
  // 数据清理默认均不启用（涉及数据删除，需用户显式配置天数后再执行）
  purgeInactiveDays: 0,
  dailyRetentionDays: 0,
  statusBarItems: DEFAULT_STATUS_BAR_ITEMS,
};
