import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MemoryType } from '../../../shared/enums';

@Entity('knowledge_items')
@Index('idx_knowledge_scope_project', ['scope', 'projectId'])
export class KnowledgeItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  scope!: 'global' | 'project' | 'agent' | 'template';

  @Column({ name: 'project_id', nullable: true })
  projectId?: string;

  @Column({ name: 'agent_id', nullable: true })
  agentId?: string;

  @Column({ type: 'varchar', length: 20 })
  type!: 'document' | 'text' | 'url' | 'code' | 'sop';

  @Column({ length: 500 })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'vector', name: 'content_vector', nullable: true })
  contentVector?: number[];

  @Column({ type: 'enum', enum: MemoryType, name: 'memory_type', nullable: true })
  memoryType?: MemoryType;

  @Column({ type: 'float', name: 'importance_score', nullable: true })
  importanceScore?: number;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @Column({ type: 'text', array: true, default: [] })
  tags!: string[];

  @Column({ type: 'text', array: true, name: 'stage_context', default: [] })
  stageContext!: string[];

  @Column({ type: 'text', array: true, name: 'tech_stack', default: [] })
  techStack!: string[];

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl?: string;

  @Column({ name: 'file_path', type: 'text', nullable: true })
  filePath?: string;

  @Column({ name: 'file_type', length: 50, nullable: true })
  fileType?: string;

  @Column({ name: 'access_count', default: 0 })
  accessCount!: number;

  @Column({ type: 'timestamp', name: 'last_accessed_at', nullable: true })
  lastAccessedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
