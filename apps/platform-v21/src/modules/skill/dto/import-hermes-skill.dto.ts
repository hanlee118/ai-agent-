import { IsObject, IsOptional, IsString } from 'class-validator';

export class ImportHermesSkillDto {
  @IsString()
  hermesSkillId!: string;

  @IsOptional()
  @IsObject()
  skillData?: Record<string, unknown>;
}
