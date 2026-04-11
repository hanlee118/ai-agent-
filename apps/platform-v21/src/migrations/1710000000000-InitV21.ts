import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitV211710000000000 implements MigrationInterface {
  name = 'InitV211710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS vector;');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(200) NOT NULL,
        description TEXT,
        project_type VARCHAR(20) NOT NULL DEFAULT 'complete',
        parent_project_id UUID,
        relay_source_stage_id UUID,
        agent_routing_strategy VARCHAR(20) DEFAULT 'auto',
        knowledge_meta JSONB DEFAULT '{}',
        generated_skill_ids UUID[] DEFAULT '{}',
        consumed_skill_ids UUID[] DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stage_templates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50),
        is_standalone BOOLEAN DEFAULT false,
        standalone_category VARCHAR(50),
        preferred_agent_type VARCHAR(20) DEFAULT 'auto',
        executor_config JSONB NOT NULL,
        skill_extraction_config JSONB DEFAULT '{}',
        input_contract JSONB DEFAULT '{}',
        output_contract JSONB DEFAULT '{}',
        input_schema JSONB NOT NULL,
        output_schema JSONB NOT NULL,
        acceptance_criteria JSONB DEFAULT '[]',
        integration_config JSONB DEFAULT '{}',
        default_timeout INTEGER DEFAULT 120,
        allow_parallel BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS project_workflows (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        template_id UUID REFERENCES stage_templates(id),
        name VARCHAR(100),
        stage_graph JSONB NOT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        current_stage_ids UUID[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS project_stages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workflow_id UUID REFERENCES project_workflows(id) ON DELETE CASCADE,
        template_key VARCHAR(50) NOT NULL,
        node_id VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        assigned_agents TEXT[] DEFAULT '{}',
        input_artifacts JSONB DEFAULT '[]',
        output_artifacts JSONB DEFAULT '[]',
        execution_trace JSONB,
        generated_skill_ids UUID[] DEFAULT '{}',
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        deadline TIMESTAMP,
        gate_results JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stage_transitions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workflow_id UUID REFERENCES project_workflows(id),
        from_stage_id UUID REFERENCES project_stages(id),
        to_stage_id UUID REFERENCES project_stages(id),
        action VARCHAR(20),
        triggered_by VARCHAR(100),
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS deliverables (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        stage_id UUID REFERENCES project_stages(id) ON DELETE SET NULL,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(50) NOT NULL,
        format VARCHAR(50),
        storage_type VARCHAR(20) NOT NULL,
        storage_path TEXT,
        content TEXT,
        metadata JSONB DEFAULT '{}',
        source_project_id UUID REFERENCES projects(id),
        source_stage_id UUID REFERENCES project_stages(id),
        is_imported BOOLEAN DEFAULT false,
        version INTEGER DEFAULT 1,
        parent_deliverable_id UUID REFERENCES deliverables(id),
        status VARCHAR(20) DEFAULT 'draft',
        reviewed_by VARCHAR(100),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS project_inputs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        content TEXT,
        file_path TEXT,
        reference_deliverable_id UUID REFERENCES deliverables(id),
        validation_status VARCHAR(20) DEFAULT 'pending',
        validation_errors JSONB,
        input_source VARCHAR(30) DEFAULT 'manual',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        scope VARCHAR(20) NOT NULL,
        project_id UUID REFERENCES projects(id),
        agent_id VARCHAR(100),
        type VARCHAR(20) NOT NULL,
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        content_vector VECTOR(1536),
        memory_type VARCHAR(20),
        importance_score FLOAT,
        metadata JSONB DEFAULT '{}',
        tags TEXT[] DEFAULT '{}',
        stage_context TEXT[] DEFAULT '{}',
        tech_stack TEXT[] DEFAULT '{}',
        source_url TEXT,
        file_path TEXT,
        file_type VARCHAR(50),
        access_count INTEGER DEFAULT 0,
        last_accessed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_id UUID REFERENCES knowledge_items(id) ON DELETE CASCADE,
        target_id UUID REFERENCES knowledge_items(id) ON DELETE CASCADE,
        relation_type VARCHAR(50) NOT NULL,
        strength FLOAT DEFAULT 1.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_id, target_id, relation_type)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS skills (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        skill_key VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(20),
        source VARCHAR(30) DEFAULT 'auto_extracted',
        manifest JSONB NOT NULL,
        instruction TEXT NOT NULL,
        examples JSONB DEFAULT '[]',
        origin_project_id UUID REFERENCES projects(id),
        origin_stage VARCHAR(50),
        extraction_date TIMESTAMP,
        usage_count INTEGER DEFAULT 0,
        success_history JSONB DEFAULT '[]',
        refinement_count INTEGER DEFAULT 0,
        observation_period_ends TIMESTAMP,
        is_certified BOOLEAN DEFAULT false,
        embedding VECTOR(1536),
        external_mappings JSONB DEFAULT '{}',
        visibility VARCHAR(20) DEFAULT 'project',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS skill_usage_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        skill_id UUID REFERENCES skills(id),
        project_id UUID REFERENCES projects(id),
        stage_id UUID REFERENCES project_stages(id),
        agent_id VARCHAR(100),
        agent_type VARCHAR(20),
        execution_context JSONB,
        success BOOLEAN DEFAULT false,
        duration_minutes INTEGER DEFAULT 0,
        user_feedback TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agent_instances (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        agent_id VARCHAR(100) UNIQUE NOT NULL,
        agent_type VARCHAR(20) NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        capabilities TEXT[] DEFAULT '{}',
        current_load INTEGER DEFAULT 0,
        max_concurrent INTEGER DEFAULT 5,
        is_healthy BOOLEAN DEFAULT true,
        last_health_check TIMESTAMP,
        memory_path TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stage_relay_relations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_project_id UUID REFERENCES projects(id),
        source_stage_id UUID REFERENCES project_stages(id),
        source_deliverable_ids UUID[] DEFAULT '{}',
        target_project_id UUID REFERENCES projects(id),
        relay_type VARCHAR(20) DEFAULT 'full',
        transformation_config JSONB,
        sync_status VARCHAR(20) DEFAULT 'active',
        last_sync_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_project_id, source_stage_id, target_project_id)
      );
    `);

    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_project_stages_workflow ON project_stages(workflow_id);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_project_stages_status ON project_stages(status);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_workflows_project ON project_workflows(project_id);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_deliverables_project ON deliverables(project_id);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_knowledge_scope_project ON knowledge_items(project_id, scope);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_knowledge_memory_type ON knowledge_items(memory_type);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge_items USING gin(tags);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_knowledge_vector ON knowledge_items USING ivfflat (content_vector vector_cosine_ops) WITH (lists = 100);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_skills_key ON skills(skill_key);');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_skills_embedding ON skills USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS stage_relay_relations;');
    await queryRunner.query('DROP TABLE IF EXISTS agent_instances;');
    await queryRunner.query('DROP TABLE IF EXISTS skill_usage_logs;');
    await queryRunner.query('DROP TABLE IF EXISTS skills;');
    await queryRunner.query('DROP TABLE IF EXISTS knowledge_relations;');
    await queryRunner.query('DROP TABLE IF EXISTS knowledge_items;');
    await queryRunner.query('DROP TABLE IF EXISTS project_inputs;');
    await queryRunner.query('DROP TABLE IF EXISTS deliverables;');
    await queryRunner.query('DROP TABLE IF EXISTS stage_transitions;');
    await queryRunner.query('DROP TABLE IF EXISTS project_stages;');
    await queryRunner.query('DROP TABLE IF EXISTS project_workflows;');
    await queryRunner.query('DROP TABLE IF EXISTS stage_templates;');
    await queryRunner.query('DROP TABLE IF EXISTS projects;');
  }
}
