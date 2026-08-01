// TypeLog 插件设置

// 计数模式
export type CountMode = "strict" | "loose";

// 统计窗口模式
export type WindowMode = "none" | "sidebar" | "floating";

export interface TypeLogSettings {
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
  // 番茄钟提醒开关
  pomodoroEnabled: boolean;
  // 番茄钟时长（分钟）
  pomodoroMinutes: number;
  // 状态栏显示统计
  showStatusBar: boolean;
  // none=不显示窗口；sidebar=侧边栏面板；floating=悬浮窗
  windowMode: WindowMode;
  // 悬浮窗置顶
  popoutAlwaysOnTop: boolean;
}

export const DEFAULT_SETTINGS: TypeLogSettings = {
  countMode: "strict",
  includePasteInSpeed: false,
  idleThresholdSec: 5,
  excludePatterns: ["node_modules/**", "*.min.js"],
  dailyWordGoal: 2000,
  dailyTimeGoalMin: 120,
  pomodoroEnabled: true,
  pomodoroMinutes: 25,
  showStatusBar: true,
  windowMode: "sidebar",
  popoutAlwaysOnTop: true,
};
