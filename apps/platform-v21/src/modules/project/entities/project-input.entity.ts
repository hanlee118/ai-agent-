import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { Deliverable } from '../../deliverable/entities/deliverable.entity';

@Entity('project_inputs')
export class ProjectInput {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.inputs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ length: 200 })
  name!: string;

  @Column({ length: 50 })
  type!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @Column({ name: 'file_path', nullable: true })
  filePath?: string;

  @Column({ name: 'reference_deliverable_id', nullable: true })
  referenceDeliverableId?: string;

  @ManyToOne(() => Deliverable, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reference_deliverable_id' })
  referenceDeliverable?: Deliverable;

  @Column({ name: 'validation_status', default: 'pending' })
  validationStatus!: 'pending' | 'valid' | 'invalid';

  @Column({ type: 'jsonb', name: 'validation_errors', nullable: true })
  validationErrors?: unknown[];

  @Column({ name: 'input_source', default: 'manual' })
  inputSource!: 'manual' | 'imported_from_project' | 'template_generated';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
