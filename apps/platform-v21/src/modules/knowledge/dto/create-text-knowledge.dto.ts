import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateTextKnowledgeDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsIn(['global', 'project', 'agent', 'template'])
  scope!: 'global' | 'project' | 'agent' | 'template';

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stageContext?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  techStack?: string[];

  @IsOptional()
  @IsIn(['episodic', 'semantic', 'procedural'])
  memoryType?: 'episodic' | 'semantic' | 'procedural';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  importanceScore?: number;
}
