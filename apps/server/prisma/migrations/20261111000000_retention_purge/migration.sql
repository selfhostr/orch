-- AuditLog stays append-only: the trigger still rejects every UPDATE and every ordinary DELETE.
-- The only way to remove rows is audit_log_purge(), which names the cutoff in a
-- transaction-local setting the trigger checks, so it can only delete rows older than that cutoff.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
DECLARE
  cutoff timestamp;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cutoff := nullif(current_setting('orch.audit_purge_before', true), '')::timestamp;
    IF cutoff IS NOT NULL AND OLD."at" < cutoff THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

-- Deletes up to batch_size audit rows older than retention_days and returns how many. Rows locked
-- by a concurrent purge are skipped, so two passes never wait for each other.
CREATE OR REPLACE FUNCTION audit_log_purge(retention_days integer, batch_size integer)
RETURNS bigint AS $$
DECLARE
  cutoff timestamp;
  purged bigint;
BEGIN
  IF retention_days < 1 OR batch_size < 1 THEN
    RAISE EXCEPTION 'audit_log_purge: retention_days and batch_size must be at least 1';
  END IF;
  cutoff := now()::timestamp - make_interval(days => retention_days);
  PERFORM set_config('orch.audit_purge_before', cutoff::text, true);
  WITH doomed AS (
    SELECT "id" FROM "AuditLog" WHERE "at" < cutoff ORDER BY "id" LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM "AuditLog" a USING doomed d WHERE a."id" = d."id";
  GET DIAGNOSTICS purged = ROW_COUNT;
  PERFORM set_config('orch.audit_purge_before', '', true);
  RETURN purged;
END;
$$ LANGUAGE plpgsql;
