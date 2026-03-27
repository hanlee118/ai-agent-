import type {
  OpenClawProjectState,
  OpenClawTaskState,
  RoleType,
  StageType,
  TaskPriority,
  TaskStatus
} from "@occ/shared";
import type { UiLocale } from "./locale";

const STAGE_LABELS_ZH: Record<StageType, string> = {
  INIT: "立项",
  ANALYSIS: "分析",
  DESIGN: "设计",
  DEV: "开发",
  ACCEPT: "验收"
};

const STAGE_LABELS_EN: Record<StageType, string> = {
  INIT: "Kickoff",
  ANALYSIS: "Analysis",
  DESIGN: "Design",
  DEV: "Build",
  ACCEPT: "Acceptance"
};

const ROLE_LABELS_ZH: Record<RoleType, string> = {
  ROLE_ASSISTANT: "总助理",
  ROLE_PM: "项目经理",
  ROLE_ANALYST: "需求分析师",
  ROLE_PRODUCT: "产品总监",
  ROLE_ARCH: "研发总监",
  ROLE_DEV: "研发经理",
  ROLE_QA: "测试工程师",
  ROLE_HR: "HR总监"
};

const ROLE_LABELS_EN: Record<RoleType, string> = {
  ROLE_ASSISTANT: "Chief of Staff",
  ROLE_PM: "Project Manager",
  ROLE_ANALYST: "Business Analyst",
  ROLE_PRODUCT: "Product Director",
  ROLE_ARCH: "Engineering Director",
  ROLE_DEV: "Engineering Lead",
  ROLE_QA: "QA Engineer",
  ROLE_HR: "People Director"
};

const TASK_STATUS_LABELS_ZH: Record<TaskStatus, string> = {
  todo: "待开始",
  in_progress: "进行中",
  blocked: "已阻塞",
  done: "已完成"
};

const TASK_STATUS_LABELS_EN: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done"
};

const TASK_PRIORITY_LABELS_ZH: Record<TaskPriority, string> = {
  low: "低优先级",
  normal: "正常优先级",
  high: "高优先级"
};

const TASK_PRIORITY_LABELS_EN: Record<TaskPriority, string> = {
  low: "Low priority",
  normal: "Normal priority",
  high: "High priority"
};

const OPENCLAW_PROJECT_STATE_LABELS_ZH: Record<OpenClawProjectState, string> = {
  active: "进行中",
  blocked: "阻塞",
  completed: "已完成",
  planned: "规划中"
};

const OPENCLAW_PROJECT_STATE_LABELS_EN: Record<OpenClawProjectState, string> = {
  active: "Active",
  blocked: "Blocked",
  completed: "Completed",
  planned: "Planned"
};

const OPENCLAW_TASK_STATE_LABELS_ZH: Record<OpenClawTaskState, string> = {
  todo: "待处理",
  in_progress: "进行中",
  blocked: "阻塞",
  done: "已完成",
  unknown: "未知"
};

const OPENCLAW_TASK_STATE_LABELS_EN: Record<OpenClawTaskState, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  unknown: "Unknown"
};

function isEnglish(locale: UiLocale) {
  return locale === "en-US";
}

export function getStageLabel(stage: StageType, locale: UiLocale) {
  return isEnglish(locale) ? STAGE_LABELS_EN[stage] : STAGE_LABELS_ZH[stage];
}

export function getRoleLabel(role: RoleType, locale: UiLocale) {
  return isEnglish(locale) ? ROLE_LABELS_EN[role] : ROLE_LABELS_ZH[role];
}

export function getTaskStatusLabel(status: TaskStatus, locale: UiLocale) {
  return isEnglish(locale) ? TASK_STATUS_LABELS_EN[status] : TASK_STATUS_LABELS_ZH[status];
}

export function getTaskPriorityLabel(priority: TaskPriority, locale: UiLocale) {
  return isEnglish(locale) ? TASK_PRIORITY_LABELS_EN[priority] : TASK_PRIORITY_LABELS_ZH[priority];
}

export function getOpenClawProjectStateLabel(status: OpenClawProjectState, locale: UiLocale) {
  return isEnglish(locale) ? OPENCLAW_PROJECT_STATE_LABELS_EN[status] : OPENCLAW_PROJECT_STATE_LABELS_ZH[status];
}

export function getOpenClawTaskStateLabel(status: OpenClawTaskState, locale: UiLocale) {
  return isEnglish(locale) ? OPENCLAW_TASK_STATE_LABELS_EN[status] : OPENCLAW_TASK_STATE_LABELS_ZH[status];
}
