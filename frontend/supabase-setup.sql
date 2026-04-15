-- GeoPunch Supabase setup
-- Mirror of backend/supabase_schema_auth.sql for app onboarding.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS enterprises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    nif VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprises_owner_user_id ON enterprises(owner_user_id);

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    employee_id VARCHAR(100),
    role VARCHAR(50) DEFAULT 'personal_user',
    account_type VARCHAR(50) DEFAULT 'personal',
    enterprise_id UUID REFERENCES enterprises(id) ON DELETE SET NULL,
    active_workplace_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'personal_user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS account_type VARCHAR(50) DEFAULT 'personal';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_workplace_id UUID;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_enterprise_id ON profiles(enterprise_id);

CREATE TABLE IF NOT EXISTS enterprise_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email VARCHAR(255) NOT NULL,
    invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    accepted_at TIMESTAMP WITH TIME ZONE,
    responded_at TIMESTAMP WITH TIME ZONE,
    removed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_memberships_enterprise_id ON enterprise_memberships(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_memberships_email ON enterprise_memberships(email);
CREATE INDEX IF NOT EXISTS idx_enterprise_memberships_user_id ON enterprise_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_memberships_status ON enterprise_memberships(status);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_memberships_status_check'
    ) THEN
        ALTER TABLE enterprise_memberships
        ADD CONSTRAINT enterprise_memberships_status_check
        CHECK (status IN ('pending', 'accepted', 'rejected', 'removed'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_memberships_unique_enterprise_email'
    ) THEN
        ALTER TABLE enterprise_memberships
        ADD CONSTRAINT enterprise_memberships_unique_enterprise_email
        UNIQUE (enterprise_id, email);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS workplaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 150,
    workdays JSONB NOT NULL DEFAULT '{"monday": true, "tuesday": true, "wednesday": true, "thursday": true, "friday": true, "saturday": false, "sunday": false}',
    schedule JSONB DEFAULT '{"startTime": "09:00", "endTime": "18:00", "marginMinutes": 120}',
    location_locked BOOLEAN DEFAULT true,
    configured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_radius CHECK (radius_meters >= 50 AND radius_meters <= 300)
);

ALTER TABLE workplaces ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE workplaces ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_workplaces_user_id ON workplaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workplaces_enterprise_id ON workplaces(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_workplaces_is_active ON workplaces(is_active);

CREATE TABLE IF NOT EXISTS employee_workplaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
    employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
    assigned_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_workplaces_enterprise_id ON employee_workplaces(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_employee_workplaces_employee_user_id ON employee_workplaces(employee_user_id);
CREATE INDEX IF NOT EXISTS idx_employee_workplaces_workplace_id ON employee_workplaces(workplace_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'employee_workplaces_unique_assignment'
    ) THEN
        ALTER TABLE employee_workplaces
        ADD CONSTRAINT employee_workplaces_unique_assignment
        UNIQUE (employee_user_id, workplace_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS punches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
    workplace_name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    punch_type VARCHAR(20) NOT NULL CHECK (punch_type IN ('IN', 'OUT', 'BREAK_START', 'BREAK_END')),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    accuracy_meters DECIMAL(10, 2) NOT NULL,
    distance_to_workplace_meters DECIMAL(10, 2) NOT NULL,
    method VARCHAR(50) DEFAULT 'manual' CHECK (method IN ('manual', 'geofence_suggestion')),
    outside_workplace BOOLEAN DEFAULT false,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_punches_user_id ON punches(user_id);
CREATE INDEX IF NOT EXISTS idx_punches_workplace_id ON punches(workplace_id);
CREATE INDEX IF NOT EXISTS idx_punches_date ON punches(date);
CREATE INDEX IF NOT EXISTS idx_punches_user_date ON punches(user_id, date);
CREATE INDEX IF NOT EXISTS idx_punches_user_workplace_date ON punches(user_id, workplace_id, date);

CREATE TABLE IF NOT EXISTS geofence_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workplace_id UUID NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('ENTER', 'EXIT')),
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    accuracy DECIMAL(10, 2) NOT NULL,
    device_time TIMESTAMP WITH TIME ZONE,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geofence_events_user_id ON geofence_events(user_id);
CREATE INDEX IF NOT EXISTS idx_geofence_events_workplace_id ON geofence_events(workplace_id);
CREATE INDEX IF NOT EXISTS idx_geofence_events_event_id ON geofence_events(event_id);
CREATE INDEX IF NOT EXISTS idx_geofence_events_processed ON geofence_events(processed);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_workplaces_updated_at ON workplaces;
CREATE TRIGGER update_workplaces_updated_at BEFORE UPDATE ON workplaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_enterprises_updated_at ON enterprises;
CREATE TRIGGER update_enterprises_updated_at BEFORE UPDATE ON enterprises
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_enterprise_memberships_updated_at ON enterprise_memberships;
CREATE TRIGGER update_enterprise_memberships_updated_at BEFORE UPDATE ON enterprise_memberships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_account_type TEXT;
BEGIN
    user_account_type := COALESCE(NEW.raw_user_meta_data->>'account_type', 'personal');

    INSERT INTO public.profiles (id, email, name, employee_id, role, account_type)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'employee_id',
        CASE
            WHEN user_account_type = 'enterprise' THEN 'enterprise_owner'
            ELSE 'personal_user'
        END,
        user_account_type
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprises ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE workplaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_workplaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofence_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;

CREATE POLICY "Users can view their own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

INSERT INTO public.profiles (id, email, name, employee_id, role, account_type, created_at, updated_at)
SELECT
    au.id,
    au.email,
    COALESCE(au.raw_user_meta_data->>'name', split_part(au.email, '@', 1)),
    au.raw_user_meta_data->>'employee_id',
    CASE
        WHEN COALESCE(au.raw_user_meta_data->>'account_type', 'personal') = 'enterprise' THEN 'enterprise_owner'
        WHEN COALESCE(au.raw_user_meta_data->>'role', '') = 'admin' THEN 'enterprise_owner'
        ELSE 'personal_user'
    END,
    COALESCE(au.raw_user_meta_data->>'account_type', 'personal'),
    au.created_at,
    NOW()
FROM auth.users au
WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = au.id
);
