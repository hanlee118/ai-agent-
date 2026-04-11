import {
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectType } from '../../../shared/enums';
import { ProjectInputDto } from './project-input.dto';

export class CreateProjectDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ProjectType)
  projectType: ProjectType = ProjectType.COMPLETE;

  @IsOptional()
  @IsString()
  templateKey?: string;

  @IsOptional()
  @IsIn(['auto', 'hermes', 'openclaw', 'hybrid'])
  agentRoutingStrategy?: 'auto' | 'hermes' | 'openclaw' | 'hybrid';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectInputDto)
  inputs?: ProjectInputDto[];

  @IsOptional()
  @IsUUID()
  sourceProjectId?: string;

  @IsOptional()
  @IsUUID()
  sourceStageId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedDeliverableTypes?: string[];
}
