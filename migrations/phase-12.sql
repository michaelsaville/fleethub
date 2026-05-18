-- Phase 12 — Operations Expansion DDL
-- Pure-additive: 6 new tables + 2 new columns. Backup taken to
-- backup-dochub-pre-phase12-20260518-172111.sql.
--
-- Applied via:
--   docker exec -i dochub-db-1 psql -U dochub -d dochub < phase-12.sql

BEGIN;

-- ─── Fl_OncallSchedule additions (WS-E.4 DST) ───────────────────────────────
ALTER TABLE fleethub.fl_oncall_schedules
  ADD COLUMN IF NOT EXISTS "timezone" TEXT;

-- ─── Fl_Tenant additions (WS-A netmon toggle) ───────────────────────────────
ALTER TABLE fleethub.fl_tenants
  ADD COLUMN IF NOT EXISTS "netmonEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Fl_EvaluatorLease (WS-E.1) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_evaluator_leases (
  "name"          TEXT PRIMARY KEY,
  "leasedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leasedUntil"   TIMESTAMP(3) NOT NULL,
  "leasedBy"      TEXT NOT NULL,
  "heartbeatAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "fl_evaluator_leases_leasedUntil_idx"
  ON fleethub.fl_evaluator_leases ("leasedUntil");

-- ─── Fl_NetworkDevice (WS-A.1) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_network_devices (
  "id"               TEXT PRIMARY KEY,
  "clientName"       TEXT NOT NULL,
  "displayName"      TEXT NOT NULL,
  "ipAddress"        TEXT NOT NULL,
  "kind"             TEXT NOT NULL,
  "snmpVersion"      TEXT NOT NULL DEFAULT 'none',
  "snmpCredentialId" TEXT,
  "icmpEnabled"      BOOLEAN NOT NULL DEFAULT TRUE,
  "pollIntervalSec"  INTEGER NOT NULL DEFAULT 60,
  "tagsJson"         TEXT,
  "isActive"         BOOLEAN NOT NULL DEFAULT TRUE,
  "lastProbedAt"     TIMESTAMP(3),
  "createdBy"        TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "fl_network_devices_clientName_isActive_idx"
  ON fleethub.fl_network_devices ("clientName", "isActive");

-- ─── Fl_NetworkProbe fact-table (WS-A.1) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_network_probes (
  "id"                TEXT PRIMARY KEY,
  "networkDeviceId"   TEXT NOT NULL REFERENCES fleethub.fl_network_devices("id") ON DELETE CASCADE,
  "ts"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind"              TEXT NOT NULL,
  "rttMs"             DOUBLE PRECISION,
  "ok"                BOOLEAN NOT NULL,
  "errorMsg"          TEXT,
  "payloadJson"       TEXT
);

CREATE INDEX IF NOT EXISTS "fl_network_probes_networkDeviceId_ts_idx"
  ON fleethub.fl_network_probes ("networkDeviceId", "ts" DESC);

-- ─── Fl_NetworkProbeHour rollup (WS-A.1) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_network_probe_hours (
  "networkDeviceId"   TEXT NOT NULL,
  "hour"              TIMESTAMP(3) NOT NULL,
  "p50Ms"             DOUBLE PRECISION,
  "p95Ms"             DOUBLE PRECISION,
  "p99Ms"             DOUBLE PRECISION,
  "lossPct"           DOUBLE PRECISION NOT NULL,
  "sampleCount"       INTEGER NOT NULL,
  PRIMARY KEY ("networkDeviceId", "hour")
);

CREATE INDEX IF NOT EXISTS "fl_network_probe_hours_hour_idx"
  ON fleethub.fl_network_probe_hours ("hour");

-- ─── Fl_MaintenanceWindow (WS-B.1) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_maintenance_windows (
  "id"                      TEXT PRIMARY KEY,
  "tenantName"              TEXT NOT NULL,
  "name"                    TEXT NOT NULL,
  "cron"                    TEXT NOT NULL,
  "durationMin"             INTEGER NOT NULL,
  "suppressAlertKindsJson"  TEXT,
  "scopeJson"               TEXT,
  "nextStart"               TIMESTAMP(3),
  "nextEnd"                 TIMESTAMP(3),
  "lastFiredAt"             TIMESTAMP(3),
  "isActive"                BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy"               TEXT NOT NULL,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "fl_maintenance_windows_tenantName_isActive_idx"
  ON fleethub.fl_maintenance_windows ("tenantName", "isActive");
CREATE INDEX IF NOT EXISTS "fl_maintenance_windows_nextStart_idx"
  ON fleethub.fl_maintenance_windows ("nextStart");

-- ─── Fl_CryptoRotation (WS-C.2) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleethub.fl_crypto_rotations (
  "id"             TEXT PRIMARY KEY,
  "purpose"        TEXT NOT NULL,
  "fromVersion"    INTEGER NOT NULL,
  "toVersion"      INTEGER NOT NULL,
  "state"          TEXT NOT NULL DEFAULT 'in-progress',
  "processed"      INTEGER NOT NULL DEFAULT 0,
  "total"          INTEGER NOT NULL DEFAULT 0,
  "currentTenant"  TEXT,
  "errorMsg"       TEXT,
  "initiatedBy"    TEXT NOT NULL,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "fl_crypto_rotations_state_startedAt_idx"
  ON fleethub.fl_crypto_rotations ("state", "startedAt");

COMMIT;
