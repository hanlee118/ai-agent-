import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListSkillsDto {
  @IsOptional()
  @IsIn(['procedural', 'cognitive', 'meta'])
  type?: 'procedural' | 'cognitive' | 'meta';

  @IsOptional()
  @IsIn(['private', 'project', 'organization', 'public'])
  visibility?: 'private' | 'project' | 'organization' | 'public';

  @IsOptional()
  @IsString()
  query?: string;
}
