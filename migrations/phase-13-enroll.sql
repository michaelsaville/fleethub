-- Phase 13 WS-D.0 — deploy-from-panel DDL.
-- Pure-additive: 2 new tables. No DROP.
--
-- Applied via:
--   docker exec -i dochub-db-1 psql -U dochub -d dochub < phase-13-enroll.sql

BEGIN;

CREATE TABLE IF NOT EXISTS fleethub.fl_enroll_tokens (
  "token"             TEXT PRIMARY KEY,
  "tenantName"        TEXT NOT NULL,
  "createdBy"         TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "consumedAt"        TIMESTAMP(3),
  "consumedByAgentId" TEXT,
  "consumedFromIp"    TEXT
);

CREATE INDEX IF NOT EXISTS "fl_enroll_tokens_tenantName_consumedAt_idx"
  ON fleethub.fl_enroll_tokens ("tenantName", "consumedAt");
CREATE INDEX IF NOT EXISTS "fl_enroll_tokens_expiresAt_idx"
  ON fleethub.fl_enroll_tokens ("expiresAt");

CREATE TABLE IF NOT EXISTS fleethub.fl_agent_registrations (
  "id"               TEXT PRIMARY KEY,
  "tenantName"       TEXT NOT NULL,
  "hostname"         TEXT,
  "os"               TEXT,
  "osVersion"        TEXT,
  "agentSecretHash"  TEXT NOT NULL,
  "enrolledAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enrolledByToken"  TEXT,
  "lastSeenAt"       TIMESTAMP(3),
  "isRevoked"        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS "fl_agent_registrations_tenantName_isRevoked_idx"
  ON fleethub.fl_agent_registrations ("tenantName", "isRevoked");

COMMIT;
