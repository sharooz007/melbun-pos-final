-- Migration: 0022_install_pgcrypto_in_public.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
