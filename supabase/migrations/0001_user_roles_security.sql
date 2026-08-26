-- Migration: Add User Roles & Security (Phase 1)
CREATE TYPE user_role_type AS ENUM ('ADMIN', 'STAFF');

-- 1. Create the user_roles table
CREATE TABLE user_roles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role_type NOT NULL DEFAULT 'STAFF',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_roles_role ON user_roles(role);

-- 2. Helper Function for RLS (Security Definer)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role_type
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM user_roles WHERE user_id = auth.uid();
$$;

-- 3. Enable Row Level Security (RLS)
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
CREATE POLICY "Users can view own role or admins can view all" 
ON user_roles FOR SELECT 
USING (
  auth.uid() = user_id 
  OR 
  public.get_my_role() = 'ADMIN'
);

CREATE POLICY "Only admins can update roles" 
ON user_roles FOR UPDATE 
USING (public.get_my_role() = 'ADMIN')
WITH CHECK (public.get_my_role() = 'ADMIN');

-- 5. Auto-Provisioning Trigger on auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'STAFF')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Updated At Trigger
CREATE TRIGGER trigger_update_user_roles_updated_at 
BEFORE UPDATE ON user_roles 
FOR EACH ROW 
EXECUTE FUNCTION moddatetime(updated_at);
