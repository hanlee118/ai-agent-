-- Agent integration engine explicit routing metadata
ALTER TABLE "ManagedAgentConfig" ADD COLUMN "integrationEngine" TEXT NOT NULL DEFAULT 'managed';

UPDATE "ManagedAgentConfig"
SET "integrationEngine" = CASE
  WHEN lower(coalesce("agentId", '')) LIKE '%hermes%'
    OR lower(coalesce("displayName", '')) LIKE '%hermes%'
    OR lower(coalesce("title", '')) LIKE '%hermes%'
    OR lower(coalesce("selectedModel", '')) LIKE '%hermes%'
    THEN 'hermes'
  WHEN lower(coalesce("agentId", '')) LIKE '%openclaw%'
    OR lower(coalesce("displayName", '')) LIKE '%openclaw%'
    OR lower(coalesce("title", '')) LIKE '%openclaw%'
    THEN 'openclaw'
  ELSE "integrationEngine"
END;
