-- Migration: 0044_phone_only_customer_support.sql
-- Enables phone-only customer creation, lookup, and automatic placeholder name upgrading

CREATE OR REPLACE FUNCTION get_or_create_customer(
    p_name TEXT,
    p_phone TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_customer RECORD;
    v_clean_phone TEXT := NULLIF(trim(p_phone), '');
    v_clean_name TEXT := NULLIF(trim(p_name), '');
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    
    -- At least one identifier (name or phone) must be provided
    IF v_clean_name IS NULL AND v_clean_phone IS NULL THEN 
        RAISE EXCEPTION 'Customer name or phone number is required'; 
    END IF;

    -- Default name for phone-only customer if name was omitted
    IF v_clean_name IS NULL THEN
        v_clean_name := 'Customer (' || v_clean_phone || ')';
    END IF;

    -- 1. If phone is provided, lookup by phone (Authoritative Identifier)
    IF v_clean_phone IS NOT NULL THEN
        SELECT * INTO v_customer FROM customers WHERE phone = v_clean_phone;
        
        IF FOUND THEN
            -- Upgrade placeholder name if a real name is now supplied
            IF v_customer.name LIKE 'Customer (%)' AND v_clean_name NOT LIKE 'Customer (%)' THEN
                UPDATE customers 
                SET name = v_clean_name, 
                    is_active = TRUE,
                    updated_at = NOW()
                WHERE id = v_customer.id
                RETURNING * INTO v_customer;
            ELSIF v_customer.is_active = FALSE THEN
                UPDATE customers 
                SET is_active = TRUE,
                    updated_at = NOW()
                WHERE id = v_customer.id
                RETURNING * INTO v_customer;
            END IF;

            RETURN jsonb_build_object(
                'success', true, 
                'customer', jsonb_build_object(
                    'id', v_customer.id, 
                    'name', v_customer.name, 
                    'phone', v_customer.phone
                )
            );
        END IF;

        -- Phone provided but not found: create new customer with conflict safety
        INSERT INTO customers (name, phone, is_active) 
        VALUES (v_clean_name, v_clean_phone, TRUE)
        ON CONFLICT (phone) WHERE phone IS NOT NULL 
        DO UPDATE SET 
            name = CASE 
                WHEN customers.name LIKE 'Customer (%)' AND EXCLUDED.name NOT LIKE 'Customer (%)' THEN EXCLUDED.name 
                ELSE customers.name 
            END,
            is_active = TRUE,
            updated_at = NOW()
        RETURNING * INTO v_customer;

        RETURN jsonb_build_object(
            'success', true, 
            'customer', jsonb_build_object(
                'id', v_customer.id, 
                'name', v_customer.name, 
                'phone', v_customer.phone
            )
        );
    END IF;

    -- 2. No phone provided: search by exact case-insensitive name for un-phoned customer
    SELECT * INTO v_customer 
    FROM customers 
    WHERE LOWER(name) = LOWER(v_clean_name) AND phone IS NULL 
    LIMIT 1;

    IF FOUND THEN
        IF v_customer.is_active = FALSE THEN
            UPDATE customers 
            SET is_active = TRUE, 
                updated_at = NOW() 
            WHERE id = v_customer.id 
            RETURNING * INTO v_customer;
        END IF;

        RETURN jsonb_build_object(
            'success', true, 
            'customer', jsonb_build_object(
                'id', v_customer.id, 
                'name', v_customer.name, 
                'phone', v_customer.phone
            )
        );
    END IF;

    -- 3. Not found: create new un-phoned customer
    INSERT INTO customers (name, phone, is_active) 
    VALUES (v_clean_name, NULL, TRUE) 
    RETURNING * INTO v_customer;

    RETURN jsonb_build_object(
        'success', true, 
        'customer', jsonb_build_object(
            'id', v_customer.id, 
            'name', v_customer.name, 
            'phone', v_customer.phone
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_or_create_customer(TEXT, TEXT) TO authenticated, service_role;
