-- V006 — the change feed's channel takes the service's new name.
--
-- The service was renamed from workflows-service to hybridflow-store, and the channel the triggers
-- announce on follows it: `kiao_workflows` becomes `kiao_hybridflow`. The listener end already
-- waits on the new name, and the migration runs before it opens — and a notification missed in
-- between costs a second of polling rather than a lost update, so the two sides never have to
-- agree mid-deploy.
CREATE OR REPLACE FUNCTION announce(new_seq bigint) RETURNS void AS $$
BEGIN
    PERFORM pg_notify('kiao_hybridflow', new_seq::text);
END;
$$ LANGUAGE plpgsql;
