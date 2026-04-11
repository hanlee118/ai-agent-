import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedTemplatesAndAgentsV211710000001000 implements MigrationInterface {
  name = 'SeedTemplatesAndAgentsV211710000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO stage_templates
        (key, name, category, is_standalone, standalone_category, preferred_agent_type, executor_config, skill_extraction_config, input_contract, output_contract, input_schema, output_schema, acceptance_criteria, integration_config, default_timeout, allow_parallel, is_active)
      VALUES
        (
          'standard_software_development',
          '标准软件开发流程',
          'pm',
          false,
          NULL,
          'auto',
          '{"type":"agent","agentRole":"Project_Manager","requiredCapabilities":[]}'::jsonb,
          '{"autoExtract":true,"evaluationThreshold":7,"requiredToolCalls":5}'::jsonb,
          '{}'::jsonb,
          '{}'::jsonb,
          '{"type":"object","properties":{}}'::jsonb,
          '{"type":"object","properties":{}}'::jsonb,
          '[]'::jsonb,
          '{}'::jsonb,
          120,
          false,
          true
        ),
        (
          'requirements_design',
          '需求设计',
          'pm',
          false,
          NULL,
          'hermes',
          '{"type":"agent","agentRole":"Product_Manager","requiredCapabilities":["prd_writing"]}'::jsonb,
          '{"autoExtract":true,"evaluationThreshold":7,"requiredToolCalls":5}'::jsonb,
          '{}'::jsonb,
          '{}'::jsonb,
          '{"type":"object","properties":{"rawRequirements":{"type":"string"}}}'::jsonb,
          '{"type":"object","properties":{"prd":{"type":"string"}}}'::jsonb,
          '[{"type":"artifact_exists","config":{"artifact":"prd"}}]'::jsonb,
          '{}'::jsonb,
          120,
          false,
          true
        ),
        (
          'visual_design',
          '视觉设计',
          'design',
          false,
          NULL,
          'hermes',
          '{"type":"agent","agentRole":"UI_Designer","requiredCapabilities":["design"]}'::jsonb,
          '{"autoExtract":true,"evaluationThreshold":7,"requiredToolCalls":5}'::jsonb,
          '{}'::jsonb,
          '{}'::jsonb,
          '{"type":"object","properties":{"prd":{"type":"string"}}}'::jsonb,
          '{"type":"object","properties":{"mockups":{"type":"array"}}}'::jsonb,
          '[{"type":"artifact_exists","config":{"artifact":"mockups","minCount":1}}]'::jsonb,
          '{"useStitch":true,"requiredTools":["figma"]}'::jsonb,
          180,
          false,
          true
        ),
        (
          'code_development',
          '代码研发',
          'dev',
          false,
          NULL,
          'openclaw',
          '{"type":"agent","agentRole":"Developer","requiredCapabilities":["coding"]}'::jsonb,
          '{"autoExtract":true,"evaluationThreshold":8,"requiredToolCalls":10}'::jsonb,
          '{}'::jsonb,
          '{}'::jsonb,
          '{"type":"object","properties":{"mockups":{"type":"array"}}}'::jsonb,
          '{"type":"object","properties":{"codeRepo":{"type":"string"}}}'::jsonb,
          '[{"type":"artifact_exists","config":{"artifact":"codeRepo"}},{"type":"auto_check","config":{"validator":"no_execution_errors"}}]'::jsonb,
          '{}'::jsonb,
          300,
          true,
          true
        ),
        (
          'qa_acceptance',
          'QA验收',
          'qa',
          false,
          NULL,
          'hybrid',
          '{"type":"hybrid","agentRole":"QA_Engineer","requiredCapabilities":["testing"]}'::jsonb,
          '{"autoExtract":true,"evaluationThreshold":7,"requiredToolCalls":5}'::jsonb,
          '{}'::jsonb,
          '{}'::jsonb,
          '{"type":"object","properties":{"codeRepo":{"type":"string"}}}'::jsonb,
          '{"type":"object","properties":{"testReport":{"type":"string"}}}'::jsonb,
          '[{"type":"artifact_exists","config":{"artifact":"testReport"}}]'::jsonb,
          '{}'::jsonb,
          240,
          false,
          true
        )
      ON CONFLICT (key) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO agent_instances (agent_id, agent_type, config, capabilities, current_load, max_concurrent, is_healthy)
      VALUES
        ('hermes-agent-1', 'hermes', '{"mcpEndpoint":"http://hermes:3001/mcp","memorySyncInterval":3600}'::jsonb, ARRAY['long_term_memory','skill_learning','planning'], 0, 5, true),
        ('openclaw-agent-1', 'openclaw', '{"apiEndpoint":"http://openclaw:3002/api"}'::jsonb, ARRAY['coding','debugging','tool_ecosystem'], 0, 5, true)
      ON CONFLICT (agent_id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM agent_instances
      WHERE agent_id IN ('hermes-agent-1', 'openclaw-agent-1');
    `);

    await queryRunner.query(`
      DELETE FROM stage_templates
      WHERE key IN (
        'standard_software_development',
        'requirements_design',
        'visual_design',
        'code_development',
        'qa_acceptance'
      );
    `);
  }
}
