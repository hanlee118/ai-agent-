import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('stage_transitions')
@Index(['workflowId', 'createdAt'])
export class StageTransition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id' })
  workflowId!: string;

  @Column({ name: 'from_stage_id', nullable: true })
  fromStageId?: string;

  @Column({ name: 'to_stage_id', nullable: true })
  toStageId?: string;

  @Column({ type: 'varchar', length: 20 })
  action!: string;

  @Column({ name: 'triggered_by' })
  triggeredBy!: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
