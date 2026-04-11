import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DeliverableService } from '../../deliverable/services/deliverable.service';
import { UploadedFileLike } from '../../../shared/interfaces/uploaded-file.interface';
import { CreateProjectDto } from '../dto/create-project.dto';
import { ProjectFactoryService } from '../services/project-factory.service';

@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projectFactory: ProjectFactoryService,
    private readonly deliverableService: DeliverableService,
  ) {}

  @Post()
  async create(@Body() dto: CreateProjectDto) {
    const project = await this.projectFactory.createProject(dto);
    return {
      success: true,
      projectId: project.id,
      type: project.projectType,
      message: `Project created as ${project.projectType}`,
    };
  }

  @Get('templates/standalone')
  async listStandaloneTemplates(@Query('category') category?: string) {
    return this.projectFactory.listStandaloneTemplates(category);
  }

  @Get('relay-sources')
  async listRelaySources(@Query('stageType') stageType?: string) {
    return this.projectFactory.listRelaySources(stageType);
  }

  @Post('upload-input')
  @UseInterceptors(FileInterceptor('file'))
  async uploadInput(@UploadedFile() file: UploadedFileLike) {
    return this.projectFactory.uploadInput(file);
  }

  @Get(':id/deliverables')
  async getDeliverables(@Param('id') projectId: string) {
    return this.deliverableService.getProjectDeliverables(projectId);
  }
}
