import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('stage_templates')
export class StageTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 50 })
  key!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ length: 50 })
  category!: string;

  @Column({ name: 'is_standalone', default: false })
  isStandalone!: boolean;

  @Column({ name: 'standalone_category', length: 50, nullable: true })
  standaloneCategory?: string;

  @Column({ name: 'preferred_agent_type', default: 'auto' })
  preferredAgentType!: 'hermes' | 'openclaw' | 'hybrid' | 'auto';

  @Column({ type: 'jsonb', name: 'executor_config' })
  executorConfig!: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'skill_extraction_config', default: {} })
  skillExtractionConfig!: {
    autoExtract: boolean;
    evaluationThreshold: number;
    requiredToolCalls: number;
  };

  @Column({ type: 'jsonb', name: 'input_contract', default: {} })
  inputContract!: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'output_contract', default: {} })
  outputContract!: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'input_schema' })
  inputSchema!: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'output_schema' })
  outputSchema!: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'acceptance_criteria', default: [] })
  acceptanceCriteria!: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', name: 'integration_config', default: {} })
  integrationConfig!: Record<string, unknown>;

  @Column({ name: 'default_timeout', default: 120 })
  defaultTimeout!: number;

  @Column({ name: 'allow_parallel', default: false })
  allowParallel!: boolean;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
