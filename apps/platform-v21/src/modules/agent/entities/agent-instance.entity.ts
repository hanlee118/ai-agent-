import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AgentType } from '../../../shared/enums';

@Entity('agent_instances')
export class AgentInstance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', unique: true })
  agentId!: string;

  @Column({ type: 'enum', enum: AgentType, name: 'agent_type' })
  agentType!: AgentType;

  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, unknown>;

  @Column({ type: 'text', array: true, default: [] })
  capabilities!: string[];

  @Column({ name: 'current_load', default: 0 })
  currentLoad!: number;

  @Column({ name: 'max_concurrent', default: 5 })
  maxConcurrent!: number;

  @Column({ name: 'is_healthy', default: true })
  isHealthy!: boolean;

  @Column({ type: 'timestamp', name: 'last_health_check', nullable: true })
  lastHealthCheck?: Date;

  @Column({ name: 'memory_path', nullable: true })
  memoryPath?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
