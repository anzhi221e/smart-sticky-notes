-- Smart Sticky Notes — Initial Schema
-- Run this in Supabase SQL Editor

-- Create tables
CREATE TABLE smartstickynotes_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    type text NOT NULL CHECK (type IN ('voice', 'text')),
    text text NOT NULL DEFAULT '',
    tags text[] NOT NULL DEFAULT '{}',
    audio_path text,
    audio_duration integer,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    synced_at timestamptz
);

CREATE TABLE deletion_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    note_id uuid NOT NULL,
    audio_path text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE smartstickynotes_config (
    user_id uuid NOT NULL DEFAULT auth.uid(),
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);

-- RLS: smartstickynotes_items
ALTER TABLE smartstickynotes_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "items_select" ON smartstickynotes_items
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "items_insert" ON smartstickynotes_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "items_update" ON smartstickynotes_items
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "items_delete" ON smartstickynotes_items
    FOR DELETE USING (auth.uid() = user_id);

-- RLS: deletion_events
ALTER TABLE deletion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deletion_select" ON deletion_events
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "deletion_insert" ON deletion_events
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "deletion_delete" ON deletion_events
    FOR DELETE USING (auth.uid() = user_id);

-- RLS: smartstickynotes_config
ALTER TABLE smartstickynotes_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config_select" ON smartstickynotes_config
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "config_insert" ON smartstickynotes_config
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "config_update" ON smartstickynotes_config
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Enforce user_id on insert
ALTER TABLE smartstickynotes_items ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE deletion_events ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE smartstickynotes_config ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Indexes
CREATE INDEX idx_items_user_status ON smartstickynotes_items(user_id, status);
CREATE INDEX idx_items_user_synced ON smartstickynotes_items(user_id, synced_at);
CREATE INDEX idx_items_user_updated ON smartstickynotes_items(user_id, updated_at);
CREATE INDEX idx_items_tags ON smartstickynotes_items USING gin(tags);
CREATE INDEX idx_deletion_user ON deletion_events(user_id);
