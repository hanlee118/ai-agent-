export enum ProjectType {
  COMPLETE = 'complete',
  STANDALONE = 'standalone',
  RELAY = 'relay',
}

export enum MemoryType {
  EPISODIC = 'episodic',
  SEMANTIC = 'semantic',
  PROCEDURAL = 'procedural',
}

export enum SkillType {
  PROCEDURAL = 'procedural',
  COGNITIVE = 'cognitive',
  META = 'meta',
}

export enum SkillSource {
  AUTO_EXTRACTED = 'auto_extracted',
  MANUAL_CREATED = 'manual_created',
  COMMUNITY_IMPORTED = 'community_imported',
  HYBRID_REFINED = 'hybrid_refined',
}

export enum AgentType {
  HERMES = 'hermes',
  OPENCLAW = 'openclaw',
  CUSTOM = 'custom',
}

export enum WorkflowStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

export enum StageStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  REVIEWING = 'reviewing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}
