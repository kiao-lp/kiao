ALTER TABLE workflow
    ADD COLUMN workflow_folder text NOT NULL DEFAULT '',
    ADD COLUMN files text[] NOT NULL DEFAULT '{}';
