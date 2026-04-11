import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('skill_usage_logs')
export class SkillUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'skill_id' })
  skillId!: string;

  @Column({ name: 'project_id' })
  projectId!: string;

  @Column({ name: 'stage_id' })
  stageId!: string;

  @Column({ name: 'agent_id', nullable: true })
  agentId?: string;

  @Column({ name: 'agent_type', nullable: true })
  agentType?: string;

  @Column({ type: 'jsonb', name: 'execution_context', nullable: true })
  executionContext?: Record<string, unknown>;

  @Column({ default: false })
  success!: boolean;

  @Column({ name: 'duration_minutes', type: 'int', default: 0 })
  durationMinutes!: number;

  @Column({ type: 'text', name: 'user_feedback', nullable: true })
  userFeedback?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
