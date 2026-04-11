import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StageStatus } from '../../../shared/enums';
import { ProjectWorkflow } from './project-workflow.entity';

@Entity('project_stages')
export class ProjectStage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id' })
  workflowId!: string;

  @ManyToOne(() => ProjectWorkflow, (wf) => wf.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow!: ProjectWorkflow;

  @Column({ name: 'template_key' })
  templateKey!: string;

  @Column({ name: 'node_id', nullable: true })
  nodeId?: string;

  @Column({ type: 'varchar', default: StageStatus.PENDING })
  status!: StageStatus;

  @Column({ type: 'text', array: true, name: 'assigned_agents', default: [] })
  assignedAgents!: string[];

  @Column({ type: 'jsonb', name: 'input_artifacts', default: [] })
  inputArtifacts!: unknown[];

  @Column({ type: 'jsonb', name: 'output_artifacts', default: [] })
  outputArtifacts!: unknown[];

  @Column({ type: 'jsonb', name: 'execution_trace', nullable: true })
  executionTrace?: {
    toolCalls?: unknown[];
    decisions?: unknown[];
    errors?: unknown[];
    resolution?: string;
  };

  @Column({ type: 'uuid', array: true, name: 'generated_skill_ids', default: [] })
  generatedSkillIds!: string[];

  @Column({ type: 'timestamp', name: 'started_at', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', name: 'completed_at', nullable: true })
  completedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  deadline?: Date;

  @Column({ type: 'jsonb', name: 'gate_results', nullable: true })
  gateResults?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
