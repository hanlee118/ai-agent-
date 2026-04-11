import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class UploadKnowledgeDto {
  @IsOptional()
  @IsIn(['global', 'project', 'agent', 'template'])
  scope?: 'global' | 'project' | 'agent' | 'template';

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString({ each: true })
  tags?: string[];
}
