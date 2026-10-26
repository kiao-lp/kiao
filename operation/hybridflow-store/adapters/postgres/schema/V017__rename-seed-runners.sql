-- V017 — the seed runners take their new names.
--
-- V013 seeded them 'VPS' and 'Home Desktop', and the pub/perso split later edited that
-- seed — and V013's comments — in place, to 'Server' and 'Desktop'. An applied migration
-- is frozen (see migrate.go), so the first binary built after the split refused to open
-- the production database. V013 is restored to the bytes the ledger recorded, and the
-- rename it tried to smuggle in is re-applied here, where new work belongs.
--
-- Conditional on the names V013 seeded: a runner renamed by its owner is left alone, and
-- only an untouched seed takes the new name. Fresh databases reach the same end state
-- through V013 then this script.

UPDATE runner SET name = 'Server'
WHERE id = 'c9f5e2a1-7b3d-4e6a-9e1c-2d4b6a8c0e12' AND name = 'VPS';

UPDATE runner SET name = 'Desktop'
WHERE id = 'd3a7f1b9-4c2e-4a8d-b5e6-1f3a5c7d9e02' AND name = 'Home Desktop';
