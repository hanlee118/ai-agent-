import 'reflect-metadata';
import { DataSource, DeepPartial } from 'typeorm';
import { StageTemplate } from '../src/modules/stage/entities/stage-template.entity';
import { AgentInstance } from '../src/modules/agent/entities/agent-instance.entity';
import { AgentType } from '../src/shared/enums';

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'agent_platform_v21',
  entities: [StageTemplate, AgentInstance],
});

const defaultTemplates: Array<DeepPartial<StageTemplate>> = [
  {
    key: 'standard_software_development',
    name: '标准软件开发流程',
    category: 'pm',
    isStandalone: false,
    preferredAgentType: 'auto',
    executorConfig: { type: 'agent', agentRole: 'Project_Manager', requiredCapabilities: [] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 7, requiredToolCalls: 5 },
    inputContract: {},
    outputContract: {},
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    acceptanceCriteria: [],
    integrationConfig: {},
  },
  {
    key: 'standalone_requirements_design',
    name: '需求设计（独立交付）',
    category: 'pm',
    isStandalone: true,
    standaloneCategory: 'requirements',
    preferredAgentType: 'hermes',
    executorConfig: { type: 'agent', agentRole: 'Product_Manager', requiredCapabilities: ['reasoning'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 7, requiredToolCalls: 3 },
    inputContract: { requiresExternalInput: true, allowedInputTypes: ['text', 'document'], inputValidationRules: [] },
    outputContract: { deliverables: ['prd'], handoffFormat: 'markdown' },
    inputSchema: { type: 'object', properties: { rawRequirements: { type: 'string' } }, required: ['rawRequirements'] },
    outputSchema: { type: 'object', properties: { prd: { type: 'string' } }, required: ['prd'] },
    acceptanceCriteria: [
      { type: 'artifact_exists', config: { artifact: 'prd', minLength: 300 } },
      { type: 'auto_check', config: { validator: 'no_execution_errors' } },
    ],
    integrationConfig: {},
  },
  {
    key: 'ui_design_standalone_hermes',
    name: 'UI设计阶段（Hermes独立）',
    category: 'design',
    isStandalone: true,
    standaloneCategory: 'visual',
    preferredAgentType: 'hermes',
    executorConfig: { type: 'agent', agentRole: 'UI_Designer', requiredCapabilities: ['ui_ux', 'design_system'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 7, requiredToolCalls: 3 },
    inputContract: { requiresExternalInput: true, allowedInputTypes: ['prd', 'text', 'document'], inputValidationRules: [] },
    outputContract: { deliverables: ['mockups', 'designTokens'], handoffFormat: 'json' },
    inputSchema: { type: 'object', properties: { prd: { type: 'string' }, brandGuidelines: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { mockups: { type: 'array' }, designTokens: { type: 'object' } }, required: ['mockups'] },
    acceptanceCriteria: [{ type: 'artifact_exists', config: { artifact: 'mockups', minCount: 1 } }],
    integrationConfig: { useStitch: false },
  },
  {
    key: 'standalone_visual_design',
    name: '视觉设计（基于PRD）',
    category: 'design',
    isStandalone: true,
    standaloneCategory: 'visual',
    preferredAgentType: 'hermes',
    executorConfig: { type: 'agent', agentRole: 'UI_Designer', requiredCapabilities: ['design', 'stitch'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 7, requiredToolCalls: 5 },
    inputContract: { requiresExternalInput: true, allowedInputTypes: ['prd'], inputValidationRules: [] },
    outputContract: { deliverables: ['mockups', 'designTokens'], handoffFormat: 'figma' },
    inputSchema: { type: 'object', properties: { prd: { type: 'string' } }, required: ['prd'] },
    outputSchema: { type: 'object', properties: { mockups: { type: 'array' } }, required: ['mockups'] },
    acceptanceCriteria: [
      { type: 'artifact_exists', config: { artifact: 'mockups', minCount: 1 } },
      { type: 'auto_check', config: { validator: 'minimum_artifact_count', min: 1 } },
    ],
    integrationConfig: { useStitch: true, requiredTools: ['figma', 'stitch'] },
  },
  {
    key: 'standalone_code_development',
    name: '代码研发（基于设计稿）',
    category: 'dev',
    isStandalone: true,
    standaloneCategory: 'code',
    preferredAgentType: 'openclaw',
    executorConfig: { type: 'agent', agentRole: 'Developer', requiredCapabilities: ['coding', 'git'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 8, requiredToolCalls: 10 },
    inputContract: { requiresExternalInput: true, allowedInputTypes: ['design_mockups'], inputValidationRules: [] },
    outputContract: { deliverables: ['codeRepo', 'testSuite'], handoffFormat: 'github' },
    inputSchema: { type: 'object', properties: { mockups: { type: 'array' } }, required: ['mockups'] },
    outputSchema: { type: 'object', properties: { codeRepo: { type: 'string' } }, required: ['codeRepo'] },
    acceptanceCriteria: [
      { type: 'artifact_exists', config: { artifact: 'codeRepo' } },
      { type: 'auto_check', config: { validator: 'no_execution_errors' } },
    ],
    integrationConfig: {},
  },
  {
    key: 'standalone_qa_acceptance',
    name: 'QA验收（独立审计）',
    category: 'qa',
    isStandalone: true,
    standaloneCategory: 'qa',
    preferredAgentType: 'hybrid',
    executorConfig: { type: 'hybrid', agentRole: 'QA_Engineer', requiredCapabilities: ['testing'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 7, requiredToolCalls: 5 },
    inputContract: { requiresExternalInput: true, allowedInputTypes: ['code_repo'], inputValidationRules: [] },
    outputContract: { deliverables: ['testReport'], handoffFormat: 'pdf' },
    inputSchema: { type: 'object', properties: { codeRepo: { type: 'string' } }, required: ['codeRepo'] },
    outputSchema: { type: 'object', properties: { testReport: { type: 'string' } }, required: ['testReport'] },
    acceptanceCriteria: [
      { type: 'artifact_exists', config: { artifact: 'testReport' } },
      { type: 'manual_approval', config: { role: 'qa_lead' } },
    ],
    integrationConfig: {},
  },
  {
    key: 'requirements_design',
    name: '需求设计',
    category: 'pm',
    preferredAgentType: 'hermes',
    executorConfig: { type: 'agent', agentRole: 'Product_Manager', requiredCapabilities: ['prd_writing'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 7, requiredToolCalls: 5 },
    inputContract: {},
    outputContract: {},
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { prd: { type: 'string' } } },
    acceptanceCriteria: [{ type: 'artifact_exists', config: { artifact: 'prd' } }],
    integrationConfig: {},
  },
  {
    key: 'visual_design',
    name: '视觉设计',
    category: 'design',
    preferredAgentType: 'hermes',
    executorConfig: { type: 'agent', agentRole: 'UI_Designer', requiredCapabilities: ['design'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 7, requiredToolCalls: 5 },
    inputContract: {},
    outputContract: {},
    inputSchema: { type: 'object', properties: { prd: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { mockups: { type: 'array' } } },
    acceptanceCriteria: [{ type: 'artifact_exists', config: { artifact: 'mockups', minCount: 1 } }],
    integrationConfig: { useStitch: true, requiredTools: ['figma'] },
  },
  {
    key: 'code_development',
    name: '代码研发',
    category: 'dev',
    preferredAgentType: 'openclaw',
    executorConfig: { type: 'agent', agentRole: 'Developer', requiredCapabilities: ['coding'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 8, requiredToolCalls: 10 },
    inputContract: {},
    outputContract: {},
    inputSchema: { type: 'object', properties: { mockups: { type: 'array' } } },
    outputSchema: { type: 'object', properties: { codeRepo: { type: 'string' } } },
    acceptanceCriteria: [
      { type: 'artifact_exists', config: { artifact: 'codeRepo' } },
      { type: 'auto_check', config: { validator: 'no_execution_errors' } },
    ],
    integrationConfig: {},
  },
  {
    key: 'qa_acceptance',
    name: 'QA验收',
    category: 'qa',
    preferredAgentType: 'hybrid',
    executorConfig: { type: 'hybrid', agentRole: 'QA_Engineer', requiredCapabilities: ['testing'] },
    skillExtractionConfig: { autoExtract: true, evaluationThreshold: 7, requiredToolCalls: 5 },
    inputContract: {},
    outputContract: {},
    inputSchema: { type: 'object', properties: { codeRepo: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { testReport: { type: 'string' } } },
    acceptanceCriteria: [
      { type: 'artifact_exists', config: { artifact: 'testReport' } },
      { type: 'auto_check', config: { validator: 'artifact_keyword_check', artifact: 'testReport', keywords: ['pass'], mode: 'any' } },
    ],
    integrationConfig: {},
  },
];

const defaultAgents: Array<DeepPartial<AgentInstance>> = [
  {
    agentId: 'hermes-agent-1',
    agentType: AgentType.HERMES,
    config: { mcpEndpoint: process.env.HERMES_MCP || 'http://localhost:3001/mcp' },
    capabilities: ['long_term_memory', 'skill_learning', 'complex_reasoning', 'planning'],
  },
  {
    agentId: 'openclaw-agent-1',
    agentType: AgentType.OPENCLAW,
    config: { apiEndpoint: process.env.OPENCLAW_API || 'http://localhost:3002/api' },
    capabilities: ['coding', 'debugging', 'ide_integration', 'tool_ecosystem'],
  },
];

async function main() {
  await dataSource.initialize();

  const templateRepo = dataSource.getRepository(StageTemplate);
  for (const template of defaultTemplates) {
    if (!template.key) {
      continue;
    }
    const exists = await templateRepo.findOne({ where: { key: template.key } });
    if (!exists) {
      await templateRepo.save(templateRepo.create(template));
    }
  }

  const agentRepo = dataSource.getRepository(AgentInstance);
  for (const agent of defaultAgents) {
    if (!agent.agentId) {
      continue;
    }
    const exists = await agentRepo.findOne({ where: { agentId: agent.agentId } });
    if (!exists) {
      await agentRepo.save(agentRepo.create(agent));
    }
  }

  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
