import { IsArray, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateKnowledgeDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

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
