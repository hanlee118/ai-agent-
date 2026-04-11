import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedUiDesignStandaloneHermesTemplate1710000003000 implements MigrationInterface {
  name = 'SeedUiDesignStandaloneHermesTemplate1710000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO stage_templates
        (
          key,
          name,
          category,
          is_standalone,
          standalone_category,
          preferred_agent_type,
          executor_config,
          skill_extraction_config,
          input_contract,
          output_contract,
          input_schema,
          output_schema,
          acceptance_criteria,
          integration_config,
          default_timeout,
          allow_parallel,
          is_active
        )
      VALUES
        (
          'ui_design_standalone_hermes',
          'UI设计阶段（Hermes独立）',
          'design',
          true,
          'visual',
          'hermes',
          '{"type":"agent","agentRole":"UI_Designer","requiredCapabilities":["ui_ux","design_system"]}'::jsonb,
          '{"autoExtract":true,"evaluationThreshold":7,"requiredToolCalls":3}'::jsonb,
          '{"requiresExternalInput":true,"allowedInputTypes":["prd","text","document"]}'::jsonb,
          '{"deliverables":["mockups","designTokens"],"handoffFormat":"json"}'::jsonb,
          '{"type":"object","properties":{"prd":{"type":"string"},"brandGuidelines":{"type":"string"}}}'::jsonb,
          '{"type":"object","properties":{"mockups":{"type":"array"},"designTokens":{"type":"object"}},"required":["mockups"]}'::jsonb,
          '[{"type":"artifact_exists","config":{"artifact":"mockups","minCount":1}}]'::jsonb,
          '{"useStitch":false}'::jsonb,
          180,
          false,
          true
        )
      ON CONFLICT (key) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM stage_templates
      WHERE key = 'ui_design_standalone_hermes';
    `);
  }
}
