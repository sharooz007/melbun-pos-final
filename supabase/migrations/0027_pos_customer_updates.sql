-- Migration: 0027_pos_customer_updates.sql

-- 1. Ensure updated_at column exists on customers with moddatetime trigger
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trigger_update_customers_updated_at ON customers;
CREATE TRIGGER trigger_update_customers_updated_at 
BEFORE UPDATE ON customers FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

-- 2. Make customer phone nullable
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;

-- 3. Replace UNIQUE constraint with partial index for non-null phone numbers
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_key;
DROP INDEX IF EXISTS idx_customers_phone;
CREATE UNIQUE INDEX idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;

-- 4. Dynamic Customer Lookup & Creation RPC
CREATE OR REPLACE FUNCTION get_or_create_customer(
    p_name TEXT,
    p_phone TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_customer RECORD;
    v_clean_phone TEXT := NULLIF(trim(p_phone), '');
    v_clean_name TEXT := trim(p_name);
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF v_clean_name IS NULL OR v_clean_name = '' THEN RAISE EXCEPTION 'Customer name required'; END IF;

    -- 1. If phone is provided, lookup by phone (Authoritative Identifier)
    IF v_clean_phone IS NOT NULL THEN
        SELECT * INTO v_customer FROM customers WHERE phone = v_clean_phone;
        
        IF FOUND THEN
            -- Found by phone: return existing customer (do not blindly mutate name if already present)
            RETURN jsonb_build_object(
                'success', true, 
                'customer', jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'phone', v_customer.phone)
            );
        END IF;

        -- Phone provided but not found: create new customer with conflict safety
        INSERT INTO customers (name, phone) 
        VALUES (v_clean_name, v_clean_phone)
        ON CONFLICT (phone) WHERE phone IS NOT NULL 
        DO UPDATE SET name = EXCLUDED.name
        RETURNING * INTO v_customer;

        RETURN jsonb_build_object(
            'success', true, 
            'customer', jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'phone', v_customer.phone)
        );
    END IF;

    -- 2. No phone provided: search by exact case-insensitive name for un-phoned customer
    SELECT * INTO v_customer 
    FROM customers 
    WHERE LOWER(name) = LOWER(v_clean_name) AND phone IS NULL 
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true, 
            'customer', jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'phone', v_customer.phone)
        );
    END IF;

    -- 3. Not found: create new un-phoned customer
    INSERT INTO customers (name, phone) 
    VALUES (v_clean_name, NULL) 
    RETURNING * INTO v_customer;

    RETURN jsonb_build_object(
        'success', true, 
        'customer', jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'phone', v_customer.phone)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_or_create_customer(TEXT, TEXT) TO authenticated, service_role;
