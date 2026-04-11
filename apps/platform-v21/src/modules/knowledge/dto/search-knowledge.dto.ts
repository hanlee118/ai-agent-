import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class SearchKnowledgeDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memoryTypes?: Array<'episodic' | 'semantic' | 'procedural'>;

  @IsOptional()
  @IsString()
  agentId?: string;
}
