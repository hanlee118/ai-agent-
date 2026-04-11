import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from '../../project/entities/project.entity';
import { ProjectStage } from '../../stage/entities/project-stage.entity';

@Entity('deliverables')
export class Deliverable {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.deliverables, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'stage_id', nullable: true })
  stageId?: string;

  @ManyToOne(() => ProjectStage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'stage_id' })
  stage?: ProjectStage;

  @Column({ length: 200 })
  name!: string;

  @Column({ length: 50 })
  type!: string;

  @Column({ length: 50, nullable: true })
  format?: string;

  @Column({ name: 'storage_type', length: 20 })
  storageType!: 's3' | 'local' | 'url' | 'embedded';

  @Column({ type: 'text', name: 'storage_path', nullable: true })
  storagePath?: string;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @Column({ name: 'source_project_id', nullable: true })
  sourceProjectId?: string;

  @Column({ name: 'source_stage_id', nullable: true })
  sourceStageId?: string;

  @Column({ name: 'is_imported', default: false })
  isImported!: boolean;

  @Column({ default: 1 })
  version!: number;

  @Column({ name: 'parent_deliverable_id', nullable: true })
  parentDeliverableId?: string;

  @Column({ default: 'draft' })
  status!: 'draft' | 'reviewed' | 'approved' | 'archived';

  @Column({ name: 'reviewed_by', nullable: true })
  reviewedBy?: string;

  @Column({ type: 'timestamp', name: 'reviewed_at', nullable: true })
  reviewedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
