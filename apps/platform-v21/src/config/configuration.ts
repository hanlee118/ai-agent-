export default () => ({
  port: Number(process.env.PORT || 3310),
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'agent_platform_v21',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    db: Number(process.env.REDIS_DB || 0),
  },
  hermes: {
    enabled: process.env.HERMES_ENABLED !== 'false',
    mcpEndpoint: process.env.HERMES_MCP || process.env.HERMES_MCP_ENDPOINT || 'http://localhost:3001/mcp',
    fallbackUrl: process.env.HERMES_FALLBACK_URL || 'http://localhost:3001/fallback',
    timeout: Number(process.env.HERMES_TIMEOUT || 180),
  },
  openclaw: {
    enabled: process.env.OPENCLAW_ENABLED !== 'false',
    apiEndpoint: process.env.OPENCLAW_API || process.env.OPENCLAW_API_ENDPOINT || 'http://localhost:3002/api',
  },
  stitch: {
    apiEndpoint: process.env.STITCH_API || 'http://localhost:3010/stitch',
  },
  skillLearning: {
    observationPeriodHours: Number(process.env.SKILL_OBSERVATION_PERIOD_HOURS || 24),
    autoExtractThreshold: Number(process.env.SKILL_AUTO_EXTRACT_THRESHOLD || 7),
    refinementTriggerUses: Number(process.env.SKILL_REFINEMENT_TRIGGER_USES || 5),
  },
  routing: {
    defaultStrategy: process.env.ROUTING_DEFAULT_STRATEGY || 'auto',
    hybridComplexityThreshold: Number(process.env.ROUTING_HYBRID_COMPLEXITY_THRESHOLD || 7),
  },
});
