import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SkillSource, SkillType } from '../../../shared/enums';

@Entity('skills')
export class Skill {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, name: 'skill_key' })
  skillKey!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'enum', enum: SkillType })
  type!: SkillType;

  @Column({ type: 'enum', enum: SkillSource, default: SkillSource.AUTO_EXTRACTED })
  source!: SkillSource;

  @Column({ type: 'jsonb' })
  manifest!: Record<string, unknown>;

  @Column({ type: 'text' })
  instruction!: string;

  @Column({ type: 'jsonb', default: [] })
  examples!: unknown[];

  @Column({ name: 'origin_project_id', nullable: true })
  originProjectId?: string;

  @Column({ name: 'origin_stage', nullable: true })
  originStage?: string;

  @Column({ type: 'timestamp', name: 'extraction_date', nullable: true })
  extractionDate?: Date;

  @Column({ name: 'usage_count', default: 0 })
  usageCount!: number;

  @Column({ type: 'jsonb', name: 'success_history', default: [] })
  successHistory!: Array<{
    projectId: string;
    success: boolean;
    duration: number;
    feedback: string;
  }>;

  @Column({ name: 'refinement_count', default: 0 })
  refinementCount!: number;

  @Column({ type: 'timestamp', name: 'observation_period_ends', nullable: true })
  observationPeriodEnds?: Date;

  @Column({ name: 'is_certified', default: false })
  isCertified!: boolean;

  @Column({ type: 'vector', nullable: true })
  embedding?: number[];

  @Column({ type: 'jsonb', name: 'external_mappings', default: {} })
  externalMappings!: Record<string, unknown>;

  @Column({ default: 'project' })
  visibility!: 'private' | 'project' | 'organization' | 'public';

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
