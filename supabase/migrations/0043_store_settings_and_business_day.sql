-- Migration: 0043_store_settings_and_business_day.sql
-- Creates store settings table and business day configuration with default 6 AM cutoff in Asia/Kolkata

CREATE TABLE IF NOT EXISTS store_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_name TEXT NOT NULL DEFAULT 'Melbun Wholesale',
    tagline TEXT DEFAULT 'Premium Wholesale & Retail POS',
    address TEXT DEFAULT 'Shop #12, Commercial Central Market, MG Road, Bengaluru, Karnataka - 560001',
    phone TEXT DEFAULT '+91 98765 43210',
    email TEXT DEFAULT 'billing@melbunwholesale.com',
    gstin TEXT DEFAULT '29ABCDE1234F1Z5',
    business_day_start_hour INTEGER NOT NULL DEFAULT 6 CHECK (business_day_start_hour >= 0 AND business_day_start_hour <= 23),
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed singleton settings row if table is empty
INSERT INTO store_settings (
    store_name, tagline, address, phone, email, gstin, business_day_start_hour, timezone
) 
SELECT 
    'Melbun Wholesale', 'Premium Wholesale & Retail POS', 
    'Shop #12, Commercial Central Market, MG Road, Bengaluru, Karnataka - 560001',
    '+91 98765 43210', 'billing@melbunwholesale.com', '29ABCDE1234F1Z5', 6, 'Asia/Kolkata'
WHERE NOT EXISTS (SELECT 1 FROM store_settings);

-- Enable RLS and Authenticated Access Policy
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users full access to store_settings" ON store_settings;
CREATE POLICY "Authenticated users full access to store_settings" 
ON store_settings FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

-- RPC to get or initialize store settings
CREATE OR REPLACE FUNCTION get_store_settings()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_settings RECORD;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;

    SELECT * INTO v_settings FROM store_settings ORDER BY created_at ASC LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO store_settings (business_day_start_hour, timezone)
        VALUES (6, 'Asia/Kolkata')
        RETURNING * INTO v_settings;
    END IF;

    RETURN to_jsonb(v_settings);
END;
$$;

-- RPC to update store settings
CREATE OR REPLACE FUNCTION update_store_settings(
    p_store_name TEXT,
    p_tagline TEXT,
    p_address TEXT,
    p_phone TEXT,
    p_email TEXT,
    p_gstin TEXT,
    p_business_day_start_hour INTEGER,
    p_timezone TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_settings_id UUID;
    v_updated RECORD;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;

    IF p_store_name IS NULL OR trim(p_store_name) = '' THEN
        RAISE EXCEPTION 'Store name is required.';
    END IF;

    IF p_business_day_start_hour IS NULL OR p_business_day_start_hour < 0 OR p_business_day_start_hour > 23 THEN
        RAISE EXCEPTION 'Business day start hour must be between 0 and 23.';
    END IF;

    SELECT id INTO v_settings_id FROM store_settings ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    
    IF v_settings_id IS NULL THEN
        INSERT INTO store_settings (
            store_name, tagline, address, phone, email, gstin, business_day_start_hour, timezone
        ) VALUES (
            trim(p_store_name), NULLIF(trim(p_tagline), ''), NULLIF(trim(p_address), ''),
            NULLIF(trim(p_phone), ''), NULLIF(trim(p_email), ''), NULLIF(trim(p_gstin), ''),
            p_business_day_start_hour, COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Kolkata')
        ) RETURNING * INTO v_updated;
    ELSE
        UPDATE store_settings
        SET store_name = trim(p_store_name),
            tagline = NULLIF(trim(p_tagline), ''),
            address = NULLIF(trim(p_address), ''),
            phone = NULLIF(trim(p_phone), ''),
            email = NULLIF(trim(p_email), ''),
            gstin = NULLIF(trim(p_gstin), ''),
            business_day_start_hour = p_business_day_start_hour,
            timezone = COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Kolkata'),
            updated_at = NOW()
        WHERE id = v_settings_id
        RETURNING * INTO v_updated;
    END IF;

    RETURN to_jsonb(v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION get_store_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_store_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated, service_role;
