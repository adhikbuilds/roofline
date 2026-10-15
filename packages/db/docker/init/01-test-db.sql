-- Runs once, on first init of the data volume.
CREATE DATABASE roofline_test OWNER roofline;
\connect roofline_test
CREATE EXTENSION IF NOT EXISTS postgis;
