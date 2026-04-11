import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexesV211710000002000 implements MigrationInterface {
  name = 'AddPerformanceIndexesV211710000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_workflows_project ON project_workflows(project_id);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_knowledge_memory_type ON knowledge_items(memory_type);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge_items USING gin(tags);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_knowledge_vector ON knowledge_items USING ivfflat (content_vector vector_cosine_ops) WITH (lists = 100);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_skills_embedding ON skills USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_skills_embedding;');
    await queryRunner.query('DROP INDEX IF EXISTS idx_knowledge_vector;');
    await queryRunner.query('DROP INDEX IF EXISTS idx_knowledge_tags;');
    await queryRunner.query('DROP INDEX IF EXISTS idx_knowledge_memory_type;');
    await queryRunner.query('DROP INDEX IF EXISTS idx_workflows_project;');
  }
}
