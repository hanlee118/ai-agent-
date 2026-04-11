import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('knowledge_relations')
@Index(['sourceId', 'targetId', 'relationType'], { unique: true })
export class KnowledgeRelation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_id' })
  sourceId!: string;

  @Column({ name: 'target_id' })
  targetId!: string;

  @Column({ name: 'relation_type' })
  relationType!: string;

  @Column({ type: 'float', default: 1 })
  strength!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
