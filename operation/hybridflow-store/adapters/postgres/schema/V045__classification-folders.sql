CREATE TABLE folder (
    scope text NOT NULL CHECK (scope <> ''),
    id    uuid NOT NULL,
    name  text NOT NULL CHECK (btrim(name) <> ''),
    PRIMARY KEY (scope, id)
);

CREATE UNIQUE INDEX folder_name_key ON folder (scope, lower(name));

-- Membership belongs to the classified row. Each collection references its own folder scope.
ALTER TABLE board
    ADD COLUMN folder_scope text NOT NULL DEFAULT 'boards' CHECK (folder_scope = 'boards'),
    ADD COLUMN folder_id uuid,
    ADD CONSTRAINT board_folder_fk FOREIGN KEY (folder_scope, folder_id)
        REFERENCES folder (scope, id) ON DELETE SET NULL (folder_id);

CREATE INDEX board_folder_idx ON board (folder_id) WHERE folder_id IS NOT NULL;
