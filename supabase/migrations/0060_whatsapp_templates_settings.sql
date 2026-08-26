-- Migration: 0060_whatsapp_templates_settings.sql
-- Adds customizable WhatsApp invoice and payment due reminder templates to store_settings

-- 1. Add template columns to store_settings if not present
ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS whatsapp_invoice_template TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_due_reminder_template TEXT;

-- 2. Populate default template content for existing rows if null
UPDATE store_settings
SET 
    whatsapp_invoice_template = COALESCE(
        whatsapp_invoice_template,
        'Hello {customer_name},' || E'\n\n' ||
        'Thank you for your purchase at *{store_name}*!' || E'\n\n' ||
        '📄 *Invoice Details*' || E'\n' ||
        '• *Invoice #:* {invoice_number}' || E'\n' ||
        '• *Date:* {date}' || E'\n' ||
        '• *Items:* {item_count}' || E'\n' ||
        '• *Total Amount:* {total_amount}' || E'\n' ||
        '• *Paid Amount:* {paid_amount}' || E'\n' ||
        '• *Payment Status:* {status}' || E'\n\n' ||
        'Thank you for shopping with us! Please visit us again.'
    ),
    whatsapp_due_reminder_template = COALESCE(
        whatsapp_due_reminder_template,
        'Hello {customer_name},' || E'\n\n' ||
        'This is a gentle payment reminder from *{store_name}* regarding *Invoice #{invoice_number}*.' || E'\n\n' ||
        '💰 *Payment Due Summary*' || E'\n' ||
        '• *Invoice #:* {invoice_number}' || E'\n' ||
        '• *Invoice Date:* {date}' || E'\n' ||
        '• *Total Amount:* {total_amount}' || E'\n' ||
        '• *Amount Paid:* {paid_amount}' || E'\n' ||
        '• *Pending Due Balance:* *{due_amount}*' || E'\n\n' ||
        'Please settle the pending balance at your earliest convenience.' || E'\n\n' ||
        'Thank you,' || E'\n' ||
        '*{store_name}*'
    )
WHERE whatsapp_invoice_template IS NULL OR whatsapp_due_reminder_template IS NULL;

-- 3. Update get_store_settings RPC
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

-- 4. Drop the old 8-parameter overload to prevent duplicate function signature in PostgreSQL
DROP FUNCTION IF EXISTS update_store_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT);

-- 5. Create the updated 10-parameter update_store_settings RPC
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
    p_whatsapp_due_reminder_template TEXT DEFAULT NULL
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
            whatsapp_invoice_template, whatsapp_due_reminder_template
        ) VALUES (
            trim(p_store_name), NULLIF(trim(p_tagline), ''), NULLIF(trim(p_address), ''),
            NULLIF(trim(p_phone), ''), NULLIF(trim(p_email), ''), NULLIF(trim(p_gstin), ''),
            p_business_day_start_hour, COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Kolkata'),
            NULLIF(trim(p_whatsapp_invoice_template), ''), NULLIF(trim(p_whatsapp_due_reminder_template), '')
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
            updated_at = NOW()
        WHERE id = v_settings_id
        RETURNING * INTO v_updated;
    END IF;

    RETURN to_jsonb(v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION get_store_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_store_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT) TO authenticated, service_role;
