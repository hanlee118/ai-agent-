import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class HermesMemoryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsIn(['episodic', 'semantic', 'procedural'])
  memoryType?: 'episodic' | 'semantic' | 'procedural';

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
  @IsNumber()
  @Min(0)
  @Max(1)
  importanceScore?: number;
}
