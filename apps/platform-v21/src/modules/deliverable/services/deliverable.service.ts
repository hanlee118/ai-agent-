import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deliverable } from '../entities/deliverable.entity';

@Injectable()
export class DeliverableService {
  constructor(
    @InjectRepository(Deliverable)
    private readonly deliverableRepo: Repository<Deliverable>,
  ) {}

  async getProjectDeliverables(projectId: string): Promise<Deliverable[]> {
    return this.deliverableRepo.find({
      where: { projectId },
      order: { updatedAt: 'DESC' },
    });
  }

  async createFromStageOutput(input: {
    projectId: string;
    stageId?: string;
    artifacts: Array<Record<string, unknown>>;
  }) {
    const created: Deliverable[] = [];

    for (const artifact of input.artifacts) {
      const deliverable = this.deliverableRepo.create({
        projectId: input.projectId,
        stageId: input.stageId,
        name: String(artifact.name || artifact.type || 'artifact'),
        type: String(artifact.type || 'document'),
        format: String(artifact.format || 'json'),
        storageType: 'embedded',
        content: typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact),
        metadata: artifact,
        status: 'reviewed',
      });
      created.push(await this.deliverableRepo.save(deliverable));
    }

    return created;
  }
}
