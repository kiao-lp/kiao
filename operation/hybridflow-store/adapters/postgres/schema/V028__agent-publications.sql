ALTER TABLE agent ADD COLUMN archived boolean NOT NULL DEFAULT false;

CREATE TABLE agent_version (
    agent_id uuid NOT NULL REFERENCES agent(id),
    version bigint NOT NULL CHECK (version > 0),
    configuration jsonb NOT NULL,
    published_at timestamptz NOT NULL,
    PRIMARY KEY (agent_id, version)
);

INSERT INTO agent_version (agent_id, version, configuration, published_at)
SELECT id, 1, jsonb_build_object(
    'agentId', id, 'version', 1, 'name', name, 'platform', platform,
    'model', model, 'profileId', profile_id, 'description', description,
    'instructions', instructions, 'publishedAt', updated_at
), updated_at FROM agent;

CREATE FUNCTION retain_agent_version() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'published agent versions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_version_immutable BEFORE UPDATE OR DELETE ON agent_version
    FOR EACH ROW EXECUTE FUNCTION retain_agent_version();
