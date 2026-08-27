-- Migration: 0062_category_hsn.sql
-- Adds HSN code placeholder support to categories table for GST invoices

ALTER TABLE categories 
ADD COLUMN IF NOT EXISTS hsn_code TEXT DEFAULT '6109';
