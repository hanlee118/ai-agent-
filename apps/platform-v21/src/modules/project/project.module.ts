import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './entities/project.entity';
import { ProjectInput } from './entities/project-input.entity';
import { StageRelayRelation } from './entities/stage-relay-relation.entity';
import { ProjectFactoryService } from './services/project-factory.service';
import { ProjectController } from './controllers/project.controller';
import { StageTemplate } from '../stage/entities/stage-template.entity';
import { ProjectStage } from '../stage/entities/project-stage.entity';
import { Deliverable } from '../deliverable/entities/deliverable.entity';
import { StageModule } from '../stage/stage.module';
import { DeliverableModule } from '../deliverable/deliverable.module';
import { FileStorageService } from '../../shared/services/file-storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, ProjectInput, StageRelayRelation, StageTemplate, ProjectStage, Deliverable]),
    StageModule,
    DeliverableModule,
  ],
  controllers: [ProjectController],
  providers: [ProjectFactoryService, FileStorageService],
  exports: [ProjectFactoryService, TypeOrmModule],
})
export class ProjectModule {}
