import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class HermesKnowledgeQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsArray()
  @IsIn(['episodic', 'semantic', 'procedural'], { each: true })
  memoryTypes?: Array<'episodic' | 'semantic' | 'procedural'>;

  @IsOptional()
  @IsString()
  query?: string;
}
