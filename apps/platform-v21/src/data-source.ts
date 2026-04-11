import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AgentInstance } from './modules/agent/entities/agent-instance.entity';
import { Deliverable } from './modules/deliverable/entities/deliverable.entity';
import { KnowledgeItem } from './modules/knowledge/entities/knowledge-item.entity';
import { KnowledgeRelation } from './modules/knowledge/entities/knowledge-relation.entity';
import { ProjectInput } from './modules/project/entities/project-input.entity';
import { Project } from './modules/project/entities/project.entity';
import { StageRelayRelation } from './modules/project/entities/stage-relay-relation.entity';
import { SkillUsageLog } from './modules/skill/entities/skill-usage-log.entity';
import { Skill } from './modules/skill/entities/skill.entity';
import { ProjectStage } from './modules/stage/entities/project-stage.entity';
import { ProjectWorkflow } from './modules/stage/entities/project-workflow.entity';
import { StageTemplate } from './modules/stage/entities/stage-template.entity';
import { StageTransition } from './modules/stage/entities/stage-transition.entity';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'agent_platform_v21',
  entities: [
    Project,
    ProjectInput,
    StageRelayRelation,
    Deliverable,
    KnowledgeItem,
    KnowledgeRelation,
    Skill,
    SkillUsageLog,
    StageTemplate,
    ProjectWorkflow,
    ProjectStage,
    StageTransition,
    AgentInstance,
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: false,
});
