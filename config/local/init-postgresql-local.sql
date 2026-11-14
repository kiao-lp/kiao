-- Runs only on a new PostgreSQL volume; create existing-volume databases manually.
-- Local credentials match postgres; hybridflow-store creates and migrates the schema.
CREATE USER hybridflow WITH ENCRYPTED PASSWORD 'glg203';
CREATE DATABASE hybridflow OWNER hybridflow;
