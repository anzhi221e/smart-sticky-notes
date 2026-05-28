-- v2 Migration: add sync_requests, remove synced_at, remove deletion_events

CREATE TABLE sync_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    requested_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'timeout')),
    processing_started_at timestamptz,
    completed_at timestamptz,
    error_message text,
    client_id text
);

ALTER TABLE sync_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_requests_select" ON sync_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sync_requests_insert" ON sync_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sync_requests_update" ON sync_requests FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sync_requests_delete" ON sync_requests FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE sync_requests ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE smartstickynotes_items DROP COLUMN IF EXISTS synced_at;

DROP TABLE IF EXISTS deletion_events;
