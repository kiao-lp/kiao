-- V004 — the board's provenance goes: the `.workflow.json` it was imported from is gone, and
-- with it the two columns that named it.
--
-- `origin_path` held the file a board came from and `doc_id` the document id it carried. Both were
-- written once, by the import, and read by nothing: no lookup resolves through either, and the files
-- they pointed at were deleted by the store's own V011 once the import had been looked at. A column
-- that says where a row came from is worth keeping while the answer can still be checked; the files
-- are gone, so the answer cannot be, and the columns are two things every board carries for nothing.

ALTER TABLE board DROP COLUMN IF EXISTS origin_path;
ALTER TABLE board DROP COLUMN IF EXISTS doc_id;
