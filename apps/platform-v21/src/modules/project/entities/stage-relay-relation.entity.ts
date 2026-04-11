import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from './project.entity';

@Entity('stage_relay_relations')
export class StageRelayRelation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_project_id' })
  sourceProjectId!: string;

  @Column({ name: 'source_stage_id' })
  sourceStageId!: string;

  @Column({ type: 'uuid', array: true, name: 'source_deliverable_ids', default: [] })
  sourceDeliverableIds!: string[];

  @Column({ name: 'target_project_id' })
  targetProjectId!: string;

  @Column({ name: 'relay_type', default: 'full' })
  relayType!: 'full' | 'partial' | 'transformed';

  @Column({ type: 'jsonb', name: 'transformation_config', nullable: true })
  transformationConfig?: Record<string, unknown>;

  @Column({ name: 'sync_status', default: 'active' })
  syncStatus!: 'active' | 'stale' | 'broken';

  @Column({ type: 'timestamp', name: 'last_sync_at', nullable: true })
  lastSyncAt?: Date;

  @ManyToOne(() => Project, (project) => project.relayOutRelations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_project_id' })
  sourceProject!: Project;

  @ManyToOne(() => Project, (project) => project.relayInRelations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_project_id' })
  targetProject!: Project;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
