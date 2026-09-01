-- Migration: 0074_variant_templates_settings_rpc.sql
-- Drop old 10-param overload to prevent signature collisions
DROP FUNCTION IF EXISTS update_store_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION update_store_settings(
    p_store_name TEXT,
    p_tagline TEXT,
    p_address TEXT,
    p_phone TEXT,
    p_email TEXT,
    p_gstin TEXT,
    p_business_day_start_hour INTEGER,
    p_timezone TEXT,
    p_whatsapp_invoice_template TEXT DEFAULT NULL,
    p_whatsapp_due_reminder_template TEXT DEFAULT NULL,
    p_variant_templates JSONB DEFAULT NULL
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
            store_name, tagline, address, phone, email, gstin, business_day_start_hour, timezone,
            whatsapp_invoice_template, whatsapp_due_reminder_template, variant_templates
        ) VALUES (
            trim(p_store_name), NULLIF(trim(p_tagline), ''), NULLIF(trim(p_address), ''),
            NULLIF(trim(p_phone), ''), NULLIF(trim(p_email), ''), NULLIF(trim(p_gstin), ''),
            p_business_day_start_hour, COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Kolkata'),
            NULLIF(trim(p_whatsapp_invoice_template), ''), NULLIF(trim(p_whatsapp_due_reminder_template), ''),
            COALESCE(p_variant_templates, '[]'::jsonb)
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
            whatsapp_invoice_template = NULLIF(trim(p_whatsapp_invoice_template), ''),
            whatsapp_due_reminder_template = NULLIF(trim(p_whatsapp_due_reminder_template), ''),
            variant_templates = COALESCE(p_variant_templates, variant_templates, '[]'::jsonb),
            updated_at = NOW()
        WHERE id = v_settings_id
        RETURNING * INTO v_updated;
    END IF;

    RETURN to_jsonb(v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION update_store_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
