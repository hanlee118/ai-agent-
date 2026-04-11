import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class SkillFeedbackDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  stageId!: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsString()
  agentType!: 'hermes' | 'openclaw';

  @IsBoolean()
  success!: boolean;

  @IsNumber()
  @Min(0)
  duration!: number;

  @IsOptional()
  @IsString()
  feedback?: string;
}
