-- Phase 11 — Security-Heavy Crypto Bundle DDL
-- Pure-additive: 6 new tables + 11 new columns. No DROP, no NOT NULL,
-- no renames. Backup taken to backup-dochub-pre-phase11-20260518-150431.sql.
--
-- Applied via:
--   docker exec -i dochub-db-1 psql -U dochub -d dochub < phase-11.sql

BEGIN;

-- ─── Fl_StaffUser additions (WS-C.2 lockout) ───────────────────────────────
ALTER TABLE fleethub.fl_staff_users
  ADD COLUMN IF NOT EXISTS "mfaFailCount"     INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mfaLockedUntil"   TIMESTAMP(3);

-- ─── Fl_Tenant additions (WS-B + WS-D policy toggles) ──────────────────────
ALTER TABLE fleethub.fl_tenants
  ADD COLUMN IF NOT EXISTS "bulkApprovalThreshold"      INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "disclosureRequiresApproval" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "shellApprovalTagsJson"      TEXT,
  ADD COLUMN IF NOT EXISTS "sessionMaxHours"            INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "passwordExpiryDays"         INTEGER NOT NULL DEFAULT 0;

-- ─── Fl_AuditLog additions (WS-E review queue) ─────────────────────────────
ALTER TABLE fleethub.fl_audit_log
  ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT       NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS "reviewedBy"   TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt"   TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "fl_audit_log_reviewStatus_createdAt_idx"
  ON fleethub.fl_audit_log ("reviewStatus", "createdAt");

-- ─── Fl_CryptoKey (WS-A.1) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_crypto_keys (
  "id"            TEXT PRIMARY KEY,
  "purpose"       TEXT NOT NULL,
  "algorithm"     TEXT NOT NULL,
  "keyMaterial"   BYTEA NOT NULL,
  "publicKey"     BYTEA,
  "version"       INTEGER NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT NOT NULL,
  "retiredAt"     TIMESTAMP(3),
  "notes"         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "fl_crypto_keys_purpose_version_key"
  ON fleethub.fl_crypto_keys ("purpose", "version");
CREATE INDEX IF NOT EXISTS "fl_crypto_keys_purpose_retiredAt_idx"
  ON fleethub.fl_crypto_keys ("purpose", "retiredAt");

-- ─── Fl_Credential (WS-A.3) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_credentials (
  "id"             TEXT PRIMARY KEY,
  "tenantName"     TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "label"          TEXT NOT NULL,
  "ciphertext"     BYTEA NOT NULL,
  "nonce"          BYTEA NOT NULL,
  "keyVersion"     INTEGER NOT NULL,
  "rotateBy"       TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "replacedAt"     TIMESTAMP(3),
  "createdBy"      TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "fl_credentials_tenantName_kind_replacedAt_idx"
  ON fleethub.fl_credentials ("tenantName", "kind", "replacedAt");
CREATE INDEX IF NOT EXISTS "fl_credentials_tenantName_replacedAt_idx"
  ON fleethub.fl_credentials ("tenantName", "replacedAt");

-- ─── Fl_CredentialDisclosureLog (WS-A.3) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_credential_disclosure_log (
  "id"             TEXT PRIMARY KEY,
  "credentialId"   TEXT NOT NULL REFERENCES fleethub.fl_credentials("id") ON DELETE CASCADE,
  "viewedBy"       TEXT NOT NULL,
  "viewedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "justification"  TEXT NOT NULL,
  "ip"             TEXT,
  "userAgent"      TEXT,
  "context"        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "fl_credential_disclosure_log_credentialId_viewedAt_idx"
  ON fleethub.fl_credential_disclosure_log ("credentialId", "viewedAt");
CREATE INDEX IF NOT EXISTS "fl_credential_disclosure_log_viewedBy_viewedAt_idx"
  ON fleethub.fl_credential_disclosure_log ("viewedBy", "viewedAt");

-- ─── Fl_ActionApproval (WS-B.1) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_action_approvals (
  "id"            TEXT PRIMARY KEY,
  "action"        TEXT NOT NULL,
  "tenantName"    TEXT NOT NULL,
  "payloadJson"   TEXT NOT NULL,
  "payloadHash"   TEXT NOT NULL,
  "requestedBy"   TEXT NOT NULL,
  "requestedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scope"         TEXT,
  "requiredRole"  TEXT NOT NULL DEFAULT 'ADMIN',
  "state"         TEXT NOT NULL DEFAULT 'pending',
  "approverEmail" TEXT,
  "approvedAt"    TIMESTAMP(3),
  "denyReason"    TEXT,
  "consumedAt"    TIMESTAMP(3),
  "expiresAt"     TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "fl_action_approvals_state_expiresAt_idx"
  ON fleethub.fl_action_approvals ("state", "expiresAt");
CREATE INDEX IF NOT EXISTS "fl_action_approvals_tenantName_state_requestedAt_idx"
  ON fleethub.fl_action_approvals ("tenantName", "state", "requestedAt");
CREATE INDEX IF NOT EXISTS "fl_action_approvals_requestedBy_requestedAt_idx"
  ON fleethub.fl_action_approvals ("requestedBy", "requestedAt");

-- ─── Fl_WebAuthnCred (WS-C.3) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_webauthn_creds (
  "id"             TEXT PRIMARY KEY,
  "userId"         TEXT NOT NULL,
  "credentialId"   BYTEA NOT NULL UNIQUE,
  "publicKey"      BYTEA NOT NULL,
  "signCount"      BIGINT NOT NULL DEFAULT 0,
  "transportsJson" TEXT,
  "name"           TEXT NOT NULL,
  "aaguid"         BYTEA,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"     TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "fl_webauthn_creds_userId_idx"
  ON fleethub.fl_webauthn_creds ("userId");

-- ─── Fl_StepUpConsumed (WS-C.3) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_step_up_consumed (
  "jti"        TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expMs"      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS "fl_step_up_consumed_expMs_idx"
  ON fleethub.fl_step_up_consumed ("expMs");

COMMIT;

-- Verification queries (run after COMMIT):
-- SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'fleethub';
-- Expected: previous + 6 new tables
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'fleethub' AND table_name = 'fl_staff_users'
--   AND column_name IN ('mfaFailCount', 'mfaLockedUntil');
-- Expected: 2 rows
