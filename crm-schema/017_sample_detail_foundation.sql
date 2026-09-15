-- Sample detail foundation.
-- Adds the field identity, collection method, custody, and review columns
-- needed by the project sample workspace and generated field reports.

ALTER TABLE project_samples
ADD COLUMN IF NOT EXISTS collected_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS collected_by_name TEXT,
ADD COLUMN IF NOT EXISTS collection_method TEXT,
ADD COLUMN IF NOT EXISTS depth_interval TEXT,
ADD COLUMN IF NOT EXISTS container_summary TEXT,
ADD COLUMN IF NOT EXISTS preservation_method TEXT,
ADD COLUMN IF NOT EXISTS requested_analyses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS field_measurements JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS lab_received_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS reviewed_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_project_samples_collected_at
ON project_samples(collected_at);

CREATE INDEX IF NOT EXISTS idx_project_samples_collected_by
ON project_samples(collected_by_user_id);

CREATE INDEX IF NOT EXISTS idx_project_samples_reviewed_by
ON project_samples(reviewed_by_user_id);

CREATE INDEX IF NOT EXISTS idx_project_samples_requested_analyses
ON project_samples USING GIN (requested_analyses);

CREATE OR REPLACE VIEW project_sample_detail_view AS
SELECT
    ps.id,
    ps.project_id,
    p.name AS project_name,
    p.account_id,
    acct.account_name,
    p.job_site_id,
    js.name AS job_site_name,
    ps.sampling_session_id,
    ss.session_name,
    ps.sample_identifier,
    ps.sample_type,
    ps.sample_matrix,
    COALESCE(ps.collected_at, ps.sample_date::timestamp, ps.created_at) AS collected_at,
    ps.collected_by_user_id,
    COALESCE(ps.collected_by_name, collector.full_name) AS collected_by_name,
    ps.collection_method,
    ps.depth_interval,
    ps.latitude,
    ps.longitude,
    ps.gps_accuracy_meters,
    ps.container_summary,
    ps.preservation_method,
    ps.requested_analyses,
    ps.field_measurements,
    ps.collection_notes,
    ps.chain_of_custody_number,
    ps.lab_name,
    ps.lab_received_at,
    ps.lab_report_uri,
    ps.lab_results,
    ps.result_summary,
    ps.status,
    ps.photo_uris,
    ps.reviewed_by_user_id,
    COALESCE(ps.reviewed_by_name, reviewer.full_name) AS reviewed_by_name,
    ps.reviewed_at,
    ps.created_at,
    ps.updated_at
FROM project_samples ps
JOIN projects p ON p.id = ps.project_id
LEFT JOIN accounts acct ON acct.id = p.account_id
LEFT JOIN job_sites js ON js.id = p.job_site_id
LEFT JOIN sampling_sessions ss ON ss.id = ps.sampling_session_id
LEFT JOIN system_users collector ON collector.id = ps.collected_by_user_id
LEFT JOIN system_users reviewer ON reviewer.id = ps.reviewed_by_user_id
WHERE ps.deleted_at IS NULL;
