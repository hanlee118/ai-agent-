import { request } from './core';

export type RoleId =
  | 'ROLE_ASSISTANT'
  | 'ROLE_PM'
  | 'ROLE_ANALYST'
  | 'ROLE_PRODUCT'
  | 'ROLE_DESIGN'
  | 'ROLE_ARCH'
  | 'ROLE_DEV'
  | 'ROLE_QA'
  | 'ROLE_HR';

export type RoleSetStatus = 'active' | 'inactive';
export type FallbackStrategy = 'template_first' | 'role_pool_auto';

export interface IndustryRoleSetSummary {
  id: string;
  industryCode: string;
  industryName: string;
  roleIds: RoleId[];
  defaultSoulRoleId: RoleId;
  status: RoleSetStatus;
  version: string;
  updatedAt: string;
}

export interface SopStep {
  order: number;
  roleId: RoleId;
  title: string;
  input: string;
  output: string;
}

export interface TeamSopWorkflow {
  id: string;
  industryRoleSetId: string;
  name: string;
  steps: SopStep[];
  requiredRoleIds: RoleId[];
  isDefault: boolean;
  version: string;
  updatedAt: string;
}

export interface TeamAssemblyRule {
  id: string;
  industryCode: string;
  mustHaveSoulRole: boolean;
  soulRoleId: RoleId;
  minRoles: number;
  maxRoles: number | null;
  fallbackStrategy: FallbackStrategy;
  updatedAt: string;
}

export interface IndustryTeamConfig {
  roleSet: IndustryRoleSetSummary;
  workflows: TeamSopWorkflow[];
  assemblyRule: TeamAssemblyRule;
}

export const roleSetsApi = {
  async list() {
    return request<IndustryRoleSetSummary[]>('/role-sets');
  },

  async get(industryCode: string) {
    return request<IndustryTeamConfig>(`/role-sets/${encodeURIComponent(industryCode)}`);
  },
};
