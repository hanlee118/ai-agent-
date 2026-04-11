import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SkillLearningService } from '../services/skill-learning.service';
import { ForHermesQueryDto } from '../dto/for-hermes-query.dto';
import { ImportHermesSkillDto } from '../dto/import-hermes-skill.dto';
import { ListSkillsDto } from '../dto/list-skills.dto';
import { SkillFeedbackDto } from '../dto/skill-feedback.dto';

@Controller('skills')
export class SkillController {
  constructor(private readonly skillService: SkillLearningService) {}

  @Get()
  async list(@Query() query: ListSkillsDto) {
    return this.skillService.list(query);
  }

  @Get('for-hermes')
  async listForHermes(@Query() query: ForHermesQueryDto) {
    const skills = await this.skillService.listForHermes({
      projectId: query.projectId,
      limit: query.limit,
    });
    return { skills };
  }

  @Post(':id/export/hermes')
  async exportToHermes(@Param('id') id: string) {
    return { hermesSkillId: await this.skillService.exportToHermes(id) };
  }

  @Post('import/hermes')
  async importFromHermes(@Body() dto: ImportHermesSkillDto) {
    const skill = await this.skillService.importFromHermes(dto.hermesSkillId, dto.skillData);
    return { skillId: skill.id };
  }

  @Post(':id/feedback')
  async feedback(@Param('id') id: string, @Body() dto: SkillFeedbackDto) {
    await this.skillService.recordUsage({
      skillId: id,
      projectId: dto.projectId,
      stageId: dto.stageId,
      agentType: dto.agentType,
      agentId: dto.agentId,
      success: dto.success,
      duration: dto.duration,
      feedback: dto.feedback,
    });
    return { success: true };
  }
}
