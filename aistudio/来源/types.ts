export type RoleType = 'PM' | 'ANALYST' | 'PRODUCT' | 'ARCH' | 'DEV' | 'QA' | 'DESIGN' | 'OPS';

export type StageType = 'INIT' | 'ANALYSIS' | 'DESIGN' | 'DEV' | 'ACCEPT';

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'blocked';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  assignee: RoleType;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  progress: number;
  deadline?: string;
  createdAt: string;
}

export interface ConfirmationRequest {
  id: string;
  projectId: string;
  agentId: RoleType;
  type: 'requirement' | 'architecture' | 'execution';
  title: string;
  goal: string;
  steps: string[];
  risks: string[];
  options: { id: string; label: string; isRecommended?: boolean }[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface Deliverable {
  id: string;
  name: string;
  type: 'markdown' | 'pdf' | 'code' | 'prototype' | 'report';
  content: string;
  createdAt: string;
  createdBy: RoleType;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'stage_start' | 'agent_action' | 'deliverable_submit' | 'blocker' | 'approval_request';
  agentId?: RoleType;
  title: string;
  content: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  currentStage: StageType;
  progress: number;
  riskLevel: 'low' | 'medium' | 'high';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  startDate: string;
  endDate?: string;
  budget?: string;
  client?: string;
  createdAt: string;
  updatedAt: string;
  team: RoleType[];
  deliverables: Deliverable[];
  timeline: TimelineEvent[];
  tasks: Task[];
  confirmations: ConfirmationRequest[];
}

export interface AgentProfile {
  roleId: RoleType;
  name: string;
  title: string;
  soul: string;
  sop: string;
  model: string;
  availableModels: string[];
  isAutonomous: boolean;
  skills: {
    professional: number;
    collaboration: number;
    learning: number;
    stability: number;
    innovation: number;
  };
  status: 'idle' | 'busy' | 'offline';
  load: number;
  performance: number;
  projectsCount: number;
  lastActive?: string;
  recentTasks?: string[];
}
