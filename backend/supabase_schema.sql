-- GeoPunch Database Schema for Supabase
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== USERS TABLE ====================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    employee_id VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user',
    active_workplace_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ==================== WORKPLACES TABLE ====================
CREATE TABLE IF NOT EXISTS workplaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

-- Indexes for workplace queries
CREATE INDEX IF NOT EXISTS idx_workplaces_user_id ON workplaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workplaces_is_active ON workplaces(is_active);

-- ==================== PUNCHES TABLE ====================
CREATE TABLE IF NOT EXISTS punches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

-- Indexes for punch queries
CREATE INDEX IF NOT EXISTS idx_punches_user_id ON punches(user_id);
CREATE INDEX IF NOT EXISTS idx_punches_workplace_id ON punches(workplace_id);
CREATE INDEX IF NOT EXISTS idx_punches_date ON punches(date);
CREATE INDEX IF NOT EXISTS idx_punches_user_date ON punches(user_id, date);
CREATE INDEX IF NOT EXISTS idx_punches_user_workplace_date ON punches(user_id, workplace_id, date);

-- ==================== GEOFENCE EVENTS TABLE ====================
CREATE TABLE IF NOT EXISTS geofence_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

-- Indexes for geofence event queries
CREATE INDEX IF NOT EXISTS idx_geofence_events_user_id ON geofence_events(user_id);
CREATE INDEX IF NOT EXISTS idx_geofence_events_workplace_id ON geofence_events(workplace_id);
CREATE INDEX IF NOT EXISTS idx_geofence_events_event_id ON geofence_events(event_id);
CREATE INDEX IF NOT EXISTS idx_geofence_events_processed ON geofence_events(processed);

-- ==================== FUNCTIONS ====================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to auto-update updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workplaces_updated_at BEFORE UPDATE ON workplaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================== ROW LEVEL SECURITY (RLS) ====================
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE workplaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofence_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view their own data" ON users
    FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update their own data" ON users
    FOR UPDATE USING (auth.uid()::text = id::text);

-- RLS Policies for workplaces table
CREATE POLICY "Users can view their own workplaces" ON workplaces
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert their own workplaces" ON workplaces
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update their own workplaces" ON workplaces
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete their own workplaces" ON workplaces
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- RLS Policies for punches table
CREATE POLICY "Users can view their own punches" ON punches
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert their own punches" ON punches
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- RLS Policies for geofence_events table
CREATE POLICY "Users can view their own geofence events" ON geofence_events
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert their own geofence events" ON geofence_events
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- ==================== NOTES ====================
-- After running this script:
-- 1. Copy your SUPABASE_URL from Project Settings > API
-- 2. Copy your SUPABASE_KEY (anon/public key) from Project Settings > API
-- 3. Add them to your .env file:
--    SUPABASE_URL=https://your-project.supabase.co
--    SUPABASE_KEY=your-anon-key
