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
import { ProjectType, WorkflowStatus } from '../../../shared/enums';
import { ProjectInput } from './project-input.entity';
import { Deliverable } from '../../deliverable/entities/deliverable.entity';
import { ProjectWorkflow } from '../../stage/entities/project-workflow.entity';
import { StageRelayRelation } from './stage-relay-relation.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: ProjectType,
    default: ProjectType.COMPLETE,
    name: 'project_type',
  })
  projectType!: ProjectType;

  @Column({ name: 'parent_project_id', nullable: true })
  parentProjectId?: string;

  @ManyToOne(() => Project, { nullable: true })
  @JoinColumn({ name: 'parent_project_id' })
  parentProject?: Project;

  @Column({ name: 'relay_source_stage_id', nullable: true })
  relaySourceStageId?: string;

  @Column({
    name: 'agent_routing_strategy',
    type: 'varchar',
    default: 'auto',
  })
  agentRoutingStrategy!: 'auto' | 'hermes' | 'openclaw' | 'hybrid';

  @Column({ type: 'jsonb', name: 'knowledge_meta', default: {} })
  knowledgeMeta!: Record<string, unknown>;

  @Column({ type: 'uuid', array: true, name: 'generated_skill_ids', default: [] })
  generatedSkillIds!: string[];

  @Column({ type: 'uuid', array: true, name: 'consumed_skill_ids', default: [] })
  consumedSkillIds!: string[];

  @Column({ type: 'varchar', default: WorkflowStatus.ACTIVE })
  status!: WorkflowStatus;

  @OneToMany(() => ProjectInput, (input) => input.project)
  inputs!: ProjectInput[];

  @OneToMany(() => Deliverable, (deliverable) => deliverable.project)
  deliverables!: Deliverable[];

  @OneToMany(() => ProjectWorkflow, (workflow) => workflow.project)
  workflows!: ProjectWorkflow[];

  @OneToMany(() => StageRelayRelation, (relation) => relation.sourceProject)
  relayOutRelations!: StageRelayRelation[];

  @OneToMany(() => StageRelayRelation, (relation) => relation.targetProject)
  relayInRelations!: StageRelayRelation[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
