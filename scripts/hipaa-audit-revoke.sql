-- HIPAA-READY §2: append-only audit log enforcement at the DB role level.
--
-- After running, the application's Postgres user (DATABASE_URL credentials)
-- can SELECT and INSERT on fleethub.fl_audit_log but is physically unable
-- to UPDATE or DELETE rows. Tampering attempts fail at the database, even
-- if application code or a compromised admin session tries.
--
-- Apply once. Idempotent (REVOKE on a permission you don't have is a noop).
--
-- Run via:
--   docker run --rm --network dochub_default \
--     -e PGPASSWORD="$DOCHUB_DB_PASSWORD" \
--     -v "$HOME/fleethub/scripts:/scripts:ro" \
--     postgres:16-alpine \
--     psql -h db -U dochub -d dochub -f /scripts/hipaa-audit-revoke.sql
--
-- (Same network/image pattern as the prisma-db-push helper documented in
-- ~/.claude/projects/-home-msaville/memory/feedback_prisma_db_push_against_live.md.)
--
-- After running, verify:
--   psql ... -c "\\dp fleethub.fl_audit_log"
-- The application user should show only `arwd*/...` minus `wd` — i.e.
-- INSERT + SELECT but no UPDATE/DELETE.

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE fleethub.fl_audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE fleethub.fl_audit_log FROM dochub;

-- Re-grant the read + append the application actually needs, in case a
-- prior `GRANT ALL` is still effective. INSERT alone, plus SELECT for the
-- /api/audit/verify chain walker.
GRANT SELECT, INSERT ON TABLE fleethub.fl_audit_log TO dochub;

-- Future-proof: any new role added later should inherit the same
-- restriction unless explicitly granted otherwise.
ALTER DEFAULT PRIVILEGES IN SCHEMA fleethub
  REVOKE UPDATE, DELETE, TRUNCATE ON TABLES FROM PUBLIC;
