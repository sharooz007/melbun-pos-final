-- Migration: 0036_fix_category_deletion.sql
-- Hardened Category Deletion: Validates active products, unlinks soft-deleted products, and adds FK index.

-- 1. Ensure foreign key index exists for performance
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category_id, is_active);

-- 2. Hardened Category Deletion RPC
CREATE OR REPLACE FUNCTION delete_category_safe(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_category_name TEXT;
    v_active_count INTEGER;
BEGIN
    -- 1. Authentication Check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    -- 2. Input Validation
    IF p_category_id IS NULL THEN
        RAISE EXCEPTION 'Category ID is required.';
    END IF;

    -- 3. Row Lock & Existence Check
    SELECT name INTO v_category_name
    FROM categories
    WHERE id = p_category_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found.';
    END IF;

    -- 4. Check for Active Products
    SELECT COUNT(*) INTO v_active_count
    FROM products
    WHERE category_id = p_category_id AND is_active = TRUE;

    IF v_active_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete category "%": % active product(s) are still assigned to it.', v_category_name, v_active_count;
    END IF;

    -- 5. Unlink Inactive / Soft-Deleted Products
    UPDATE products 
    SET category_id = NULL, updated_at = NOW() 
    WHERE category_id = p_category_id AND is_active = FALSE;

    -- 6. Delete Category
    DELETE FROM categories WHERE id = p_category_id;

    RETURN jsonb_build_object(
        'success', true, 
        'category_id', p_category_id,
        'category_name', v_category_name
    );
END;
$$;

GRANT EXECUTE ON FUNCTION delete_category_safe(UUID) TO authenticated, service_role;
