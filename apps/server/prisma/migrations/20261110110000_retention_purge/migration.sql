-- Indexes on the date column each retention purge filters on (WebhookDelivery.receivedAt and
-- the other purged tables already have one).
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "EnrollmentToken_expiresAt_idx" ON "EnrollmentToken"("expiresAt");
CREATE INDEX "Assignment_status_updatedAt_idx" ON "Assignment"("status", "updatedAt");

-- AuditLog stays append-only: the trigger rejects every UPDATE. It lets a DELETE through only for a
-- row older than 30 days (hard floor, whatever any session setting says) that is also older than
-- the cutoff audit_log_purge() names in a transaction-local setting.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
DECLARE
  cutoff timestamp;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cutoff := nullif(current_setting('orch.audit_purge_before', true), '')::timestamp;
    IF cutoff IS NOT NULL
       AND OLD."at" < cutoff
       AND OLD."at" < now()::timestamp - interval '30 days' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

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
  cutoff := now()::timestamp - make_interval(days => retention_days);
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
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
