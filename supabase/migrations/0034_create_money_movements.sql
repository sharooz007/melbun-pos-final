-- Migration: 0034_create_money_movements.sql
-- Fixes P0 runtime crash where void_expense attempts to insert into a missing table.

CREATE TYPE money_movement_direction AS ENUM ('IN', 'OUT');

CREATE TABLE money_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type money_movement_direction NOT NULL,
    amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
    method payment_method NOT NULL,
    reference_id UUID,
    reference_type TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying history by reference
CREATE INDEX idx_money_movements_reference_id ON money_movements(reference_id);
CREATE INDEX idx_money_movements_created_at ON money_movements(created_at);

-- Disable RLS on core financial ledger tables since they are managed strictly via SECURITY DEFINER RPCs (pos-v2 standard)
ALTER TABLE money_movements DISABLE ROW LEVEL SECURITY;
