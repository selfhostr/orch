-- Note: CREATE INDEX takes a lock that blocks writes to the table while it builds; on a very large
-- audit log this can take a few seconds.
-- Indexes on the date column each retention purge filters on (WebhookDelivery.receivedAt and
-- the other purged tables already have one).
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "EnrollmentToken_expiresAt_idx" ON "EnrollmentToken"("expiresAt");
CREATE INDEX "Assignment_status_updatedAt_idx" ON "Assignment"("status", "updatedAt");

-- AuditLog stays append-only: the trigger rejects every UPDATE and TRUNCATE. It lets a DELETE
-- through only for a row older than 30 days (hard floor) that is also older than the cutoff
-- audit_log_purge() names in a transaction-local setting. "at" is a timestamp without time zone
-- holding UTC, so every comparison is made in UTC and the functions pin TimeZone: the floor does
-- not depend on the session's time zone. Any session can still forge the setting and delete rows
-- older than 30 days (the table owner can also disable triggers); rows younger than 30 days are
-- protected.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
DECLARE
  cutoff timestamp;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cutoff := nullif(current_setting('orch.audit_purge_before', true), '')::timestamp;
    IF cutoff IS NOT NULL
       AND OLD."at" < cutoff
       AND OLD."at" < (now() AT TIME ZONE 'UTC') - interval '30 days' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public SET TimeZone = 'UTC';

-- Deletes up to batch_size audit rows older than retention_days (at least 30) and returns how many.
-- Rows locked by a concurrent purge are skipped, so two passes never wait for each other.
CREATE OR REPLACE FUNCTION audit_log_purge(retention_days integer, batch_size integer)
RETURNS bigint AS $$
DECLARE
  cutoff timestamp;
  purged bigint;
BEGIN
  IF retention_days < 30 OR batch_size < 1 THEN
    RAISE EXCEPTION 'audit_log_purge: retention_days must be at least 30 and batch_size at least 1';
  END IF;
  cutoff := (now() AT TIME ZONE 'UTC') - make_interval(days => retention_days);
  PERFORM set_config('orch.audit_purge_before', cutoff::text, true);
  WITH doomed AS (
    SELECT "id" FROM "AuditLog" WHERE "at" < cutoff ORDER BY "at" LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM "AuditLog" a USING doomed d WHERE a."id" = d."id";
  GET DIAGNOSTICS purged = ROW_COUNT;
  PERFORM set_config('orch.audit_purge_before', '', true);
  RETURN purged;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public SET TimeZone = 'UTC';

CREATE OR REPLACE FUNCTION audit_log_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER audit_log_no_truncate
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate();
