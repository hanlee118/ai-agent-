import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { HealthModule } from './modules/health/health.module';
import { ProjectModule } from './modules/project/project.module';
import { StageModule } from './modules/stage/stage.module';
import { SkillModule } from './modules/skill/skill.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { AgentModule } from './modules/agent/agent.module';
import { DeliverableModule } from './modules/deliverable/deliverable.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.database'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: config.get<boolean>('database.migrationsRun') ?? false,
        migrations: [__dirname + '/migrations/*{.js,.ts}'],
      }),
    }),
    ProjectModule,
    StageModule,
    SkillModule,
    KnowledgeModule,
    AgentModule,
    DeliverableModule,
    HealthModule,
  ],
})
export class AppModule {}
