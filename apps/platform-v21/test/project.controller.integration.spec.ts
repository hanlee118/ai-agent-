import { Test } from '@nestjs/testing';
import { ProjectController } from '../src/modules/project/controllers/project.controller';
import { ProjectType } from '../src/shared/enums';
import { ProjectFactoryService } from '../src/modules/project/services/project-factory.service';
import { DeliverableService } from '../src/modules/deliverable/services/deliverable.service';

describe('ProjectController Integration', () => {
  it('creates project through controller-service wiring', async () => {
    const projectFactory = {
      createProject: jest.fn().mockResolvedValue({
        id: 'project-100',
        projectType: ProjectType.COMPLETE,
      }),
      listStandaloneTemplates: jest.fn(),
      listRelaySources: jest.fn(),
      uploadInput: jest.fn(),
    };
    const deliverableService = {
      getProjectDeliverables: jest.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        { provide: ProjectFactoryService, useValue: projectFactory },
        { provide: DeliverableService, useValue: deliverableService },
      ],
    }).compile();

    const controller = module.get(ProjectController);
    const result = await controller.create({
      name: 'Integration Demo',
      projectType: ProjectType.COMPLETE,
    } as never);

    expect(result.success).toBe(true);
    expect(result.projectId).toBe('project-100');
    expect(projectFactory.createProject).toHaveBeenCalled();
  });
});
