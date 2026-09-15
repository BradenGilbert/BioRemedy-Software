CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Operations project architecture.
-- Keeps the All Projects page, project detail workspace, field chronology,
-- sampling records, and LiDAR/spatial files modeled as durable backend data.

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS project_class TEXT CHECK (
    project_class IS NULL OR project_class IN ('Emergency Response', 'Multi-Stage Remediation', 'Scheduled Work')
),
ADD COLUMN IF NOT EXISTS progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
ADD COLUMN IF NOT EXISTS active_phase TEXT,
ADD COLUMN IF NOT EXISTS margin_watch TEXT,
ADD COLUMN IF NOT EXISTS not_to_exceed NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS generator_name TEXT,
ADD COLUMN IF NOT EXISTS generator_site_name TEXT,
ADD COLUMN IF NOT EXISTS generator_contact_name TEXT,
ADD COLUMN IF NOT EXISTS generator_contact_phone TEXT,
ADD COLUMN IF NOT EXISTS epa_id TEXT,
ADD COLUMN IF NOT EXISTS tceq_id TEXT,
ADD COLUMN IF NOT EXISTS insurance_contact TEXT,
ADD COLUMN IF NOT EXISTS insurance_carrier TEXT,
ADD COLUMN IF NOT EXISTS claim_number TEXT,
ADD COLUMN IF NOT EXISTS service_profile TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_project_class ON projects(project_class);
CREATE INDEX IF NOT EXISTS idx_projects_progress_percent ON projects(progress_percent);
CREATE INDEX IF NOT EXISTS idx_projects_generator_name ON projects(generator_name);

CREATE TABLE IF NOT EXISTS project_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'schedule',
            'site_note',
            'sampling',
            'sample_result',
            'spatial_upload',
            'alert',
            'material_log',
            'equipment_log',
            'communication',
            'status_change',
            'safety',
            'finance',
            'other'
        )
    ),
    title TEXT NOT NULL,
    body TEXT,
    event_at TIMESTAMP NOT NULL DEFAULT now(),
    actor_user_id UUID,
    actor_name TEXT,
    source_table_name TEXT,
    source_record_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_project_events_project_id ON project_events(project_id);
CREATE INDEX IF NOT EXISTS idx_project_events_type ON project_events(event_type);
CREATE INDEX IF NOT EXISTS idx_project_events_event_at ON project_events(event_at);
CREATE INDEX IF NOT EXISTS idx_project_events_source ON project_events(source_table_name, source_record_id);
CREATE INDEX IF NOT EXISTS idx_project_events_metadata ON project_events USING GIN (metadata);

CREATE TABLE IF NOT EXISTS sampling_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_name TEXT NOT NULL,
    chain_of_custody_number TEXT,
    lab_name TEXT,
    status TEXT DEFAULT 'Planned',
    sampling_date DATE,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    field_lead_name TEXT,
    weather_summary TEXT,
    gps_summary TEXT,
    sample_plan TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_sampling_sessions_project_id ON sampling_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sampling_sessions_date ON sampling_sessions(sampling_date);
CREATE INDEX IF NOT EXISTS idx_sampling_sessions_status ON sampling_sessions(status);

CREATE TABLE IF NOT EXISTS project_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sampling_session_id UUID REFERENCES sampling_sessions(id) ON DELETE SET NULL,
    sample_identifier TEXT NOT NULL,
    sample_type TEXT,
    sample_matrix TEXT,
    sample_date DATE,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    gps_accuracy_meters NUMERIC(8,2),
    lab_name TEXT,
    lab_report_uri TEXT,
    lab_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_summary TEXT,
    chain_of_custody_number TEXT,
    status TEXT DEFAULT 'Collected',
    photo_uris TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    collection_notes TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (project_id, sample_identifier)
);

CREATE INDEX IF NOT EXISTS idx_project_samples_project_id ON project_samples(project_id);
CREATE INDEX IF NOT EXISTS idx_project_samples_session_id ON project_samples(sampling_session_id);
CREATE INDEX IF NOT EXISTS idx_project_samples_identifier ON project_samples(sample_identifier);
CREATE INDEX IF NOT EXISTS idx_project_samples_lab_results ON project_samples USING GIN (lab_results);

CREATE TABLE IF NOT EXISTS project_spatial_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_type TEXT NOT NULL CHECK (file_type IN ('lidar', 'photogrammetry', 'drone_photo', 'map_layer', 'survey', 'other')),
    title TEXT NOT NULL,
    storage_uri TEXT,
    preview_uri TEXT,
    captured_at TIMESTAMP,
    uploaded_by_name TEXT,
    scan_quality TEXT,
    point_count BIGINT,
    coverage_label TEXT,
    coordinate_reference_system TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_project_spatial_files_project_id ON project_spatial_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_spatial_files_type ON project_spatial_files(file_type);
CREATE INDEX IF NOT EXISTS idx_project_spatial_files_captured_at ON project_spatial_files(captured_at);
CREATE INDEX IF NOT EXISTS idx_project_spatial_files_metadata ON project_spatial_files USING GIN (metadata);

CREATE OR REPLACE VIEW operations_all_projects_view AS
SELECT
    p.id,
    p.account_id,
    acct.account_name,
    p.facility_id,
    p.job_site_id,
    js.name AS job_site_name,
    p.name,
    p.project_type,
    p.project_class,
    p.status,
    p.priority,
    p.progress_percent,
    p.active_phase,
    p.margin_watch,
    p.generator_name,
    p.generator_site_name,
    p.epa_id,
    p.tceq_id,
    p.insurance_contact,
    p.insurance_carrier,
    p.claim_number,
    p.service_profile,
    COUNT(DISTINCT pe.id) FILTER (WHERE pe.deleted_at IS NULL) AS event_count,
    COUNT(DISTINCT ss.id) FILTER (WHERE ss.deleted_at IS NULL) AS sampling_session_count,
    COUNT(DISTINCT ps.id) FILTER (WHERE ps.deleted_at IS NULL) AS sample_count,
    COUNT(DISTINCT sf.id) FILTER (WHERE sf.deleted_at IS NULL) AS spatial_file_count,
    p.start_date,
    p.end_date,
    p.created_at,
    p.updated_at
FROM projects p
LEFT JOIN accounts acct ON acct.id = p.account_id
LEFT JOIN job_sites js ON js.id = p.job_site_id
LEFT JOIN project_events pe ON pe.project_id = p.id
LEFT JOIN sampling_sessions ss ON ss.project_id = p.id
LEFT JOIN project_samples ps ON ps.project_id = p.id
LEFT JOIN project_spatial_files sf ON sf.project_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id, acct.account_name, js.name;

CREATE OR REPLACE VIEW project_chronology_view AS
SELECT
    pe.project_id,
    pe.id AS source_id,
    'project_event' AS source_type,
    pe.event_type,
    pe.title,
    pe.body,
    pe.event_at,
    pe.actor_name,
    pe.metadata
FROM project_events pe
WHERE pe.deleted_at IS NULL

UNION ALL

SELECT
    ss.project_id,
    ss.id AS source_id,
    'sampling_session' AS source_type,
    'sampling' AS event_type,
    ss.session_name AS title,
    ss.notes AS body,
    COALESCE(ss.started_at, ss.sampling_date::timestamp, ss.created_at) AS event_at,
    ss.field_lead_name AS actor_name,
    jsonb_build_object(
        'lab_name', ss.lab_name,
        'chain_of_custody_number', ss.chain_of_custody_number,
        'status', ss.status
    ) AS metadata
FROM sampling_sessions ss
WHERE ss.deleted_at IS NULL

UNION ALL

SELECT
    ps.project_id,
    ps.id AS source_id,
    'sample_record' AS source_type,
    'sample_result' AS event_type,
    ps.sample_identifier AS title,
    ps.result_summary AS body,
    COALESCE(ps.sample_date::timestamp, ps.created_at) AS event_at,
    NULL AS actor_name,
    jsonb_build_object(
        'lab_name', ps.lab_name,
        'status', ps.status,
        'latitude', ps.latitude,
        'longitude', ps.longitude,
        'chain_of_custody_number', ps.chain_of_custody_number
    ) AS metadata
FROM project_samples ps
WHERE ps.deleted_at IS NULL

UNION ALL

SELECT
    sf.project_id,
    sf.id AS source_id,
    'spatial_file' AS source_type,
    'spatial_upload' AS event_type,
    sf.title,
    sf.coverage_label AS body,
    COALESCE(sf.captured_at, sf.created_at) AS event_at,
    sf.uploaded_by_name AS actor_name,
    jsonb_build_object(
        'file_type', sf.file_type,
        'scan_quality', sf.scan_quality,
        'point_count', sf.point_count,
        'storage_uri', sf.storage_uri,
        'preview_uri', sf.preview_uri
    ) AS metadata
FROM project_spatial_files sf
WHERE sf.deleted_at IS NULL;
