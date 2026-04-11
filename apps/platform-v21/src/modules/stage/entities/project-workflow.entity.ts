import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkflowStatus } from '../../../shared/enums';
import { Project } from '../../project/entities/project.entity';
import { StageTemplate } from './stage-template.entity';
import { ProjectStage } from './project-stage.entity';

@Entity('project_workflows')
export class ProjectWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.workflows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'template_id', nullable: true })
  templateId?: string;

  @ManyToOne(() => StageTemplate, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'template_id' })
  template?: StageTemplate;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'jsonb', name: 'stage_graph' })
  stageGraph!: {
    nodes: Array<{ id: string; templateKey: string; config?: Record<string, unknown> }>;
    edges: Array<{ from: string; to: string; condition?: string }>;
  };

  @Column({ type: 'varchar', default: WorkflowStatus.DRAFT })
  status!: WorkflowStatus;

  @Column({ type: 'uuid', array: true, name: 'current_stage_ids', default: [] })
  currentStageIds!: string[];

  @OneToMany(() => ProjectStage, (stage) => stage.workflow)
  stages!: ProjectStage[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
