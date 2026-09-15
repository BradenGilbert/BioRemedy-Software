CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Front Line device, package, command, upload, and incremental sync contracts.
-- Mobile clients never query ERP tables directly. They receive scoped packages
-- and submit idempotent commands through the service API.

CREATE TABLE IF NOT EXISTS frontline_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_identifier TEXT NOT NULL UNIQUE,
    display_name TEXT,
    platform TEXT NOT NULL CHECK (
        platform IN ('ios', 'android', 'windows', 'web', 'other')
    ),
    device_model TEXT,
    operating_system_version TEXT,
    app_version TEXT,
    public_key TEXT,
    registration_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        registration_status IN ('pending', 'active', 'suspended', 'revoked', 'retired')
    ),
    registered_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    registered_at TIMESTAMP,
    last_seen_at TIMESTAMP,
    revoked_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMP,
    revoke_reason TEXT,
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_frontline_devices_status
ON frontline_devices(registration_status, last_seen_at);

CREATE TABLE IF NOT EXISTS frontline_device_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frontline_device_id UUID NOT NULL REFERENCES frontline_devices(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    effective_start TIMESTAMP NOT NULL DEFAULT now(),
    effective_end TIMESTAMP,
    assignment_status TEXT NOT NULL DEFAULT 'active' CHECK (
        assignment_status IN ('planned', 'active', 'ended', 'revoked')
    ),
    assigned_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);

CREATE INDEX IF NOT EXISTS idx_frontline_device_assignments_device
ON frontline_device_assignments(frontline_device_id, assignment_status);

CREATE INDEX IF NOT EXISTS idx_frontline_device_assignments_employee
ON frontline_device_assignments(employee_id, assignment_status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_frontline_device_assignment_active
ON frontline_device_assignments(frontline_device_id)
WHERE assignment_status = 'active' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS frontline_device_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frontline_device_id UUID NOT NULL REFERENCES frontline_devices(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    system_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    session_identifier_hash TEXT NOT NULL UNIQUE,
    authenticated_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL,
    last_activity_at TIMESTAMP,
    ended_at TIMESTAMP,
    end_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (expires_at > authenticated_at)
);

CREATE INDEX IF NOT EXISTS idx_frontline_device_sessions_device
ON frontline_device_sessions(frontline_device_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_frontline_device_sessions_employee
ON frontline_device_sessions(employee_id, expires_at);

CREATE TABLE IF NOT EXISTS frontline_job_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    package_version INTEGER NOT NULL CHECK (package_version > 0),
    package_status TEXT NOT NULL DEFAULT 'building' CHECK (
        package_status IN ('building', 'ready', 'superseded', 'expired', 'revoked', 'failed')
    ),
    manifest_hash TEXT,
    manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    minimum_app_version TEXT,
    generated_at TIMESTAMP,
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (work_order_id, package_version)
);

CREATE INDEX IF NOT EXISTS idx_frontline_job_packages_job_status
ON frontline_job_packages(work_order_id, package_status);

CREATE TABLE IF NOT EXISTS frontline_job_package_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frontline_job_package_id UUID NOT NULL REFERENCES frontline_job_packages(id) ON DELETE CASCADE,
    job_assignment_id UUID REFERENCES job_assignments(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    frontline_device_id UUID REFERENCES frontline_devices(id) ON DELETE SET NULL,
    delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        delivery_status IN ('pending', 'available', 'downloaded', 'acknowledged', 'revoked', 'failed')
    ),
    available_at TIMESTAMP,
    downloaded_at TIMESTAMP,
    acknowledged_at TIMESTAMP,
    last_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (frontline_job_package_id, employee_id, frontline_device_id)
);

CREATE INDEX IF NOT EXISTS idx_frontline_job_package_recipients_employee
ON frontline_job_package_recipients(employee_id, delivery_status);

CREATE INDEX IF NOT EXISTS idx_frontline_job_package_recipients_device
ON frontline_job_package_recipients(frontline_device_id, delivery_status);

CREATE TABLE IF NOT EXISTS frontline_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frontline_device_id UUID NOT NULL REFERENCES frontline_devices(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
    job_assignment_id UUID REFERENCES job_assignments(id) ON DELETE SET NULL,
    client_command_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID,
    expected_row_version BIGINT,
    client_created_at TIMESTAMP NOT NULL,
    server_received_at TIMESTAMP NOT NULL DEFAULT now(),
    processing_status TEXT NOT NULL DEFAULT 'received' CHECK (
        processing_status IN (
            'received',
            'validating',
            'applied',
            'rejected',
            'conflict',
            'retry'
        )
    ),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_code TEXT,
    error_detail TEXT,
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (frontline_device_id, client_command_id),
    UNIQUE (frontline_device_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_frontline_commands_device_status
ON frontline_commands(frontline_device_id, processing_status, server_received_at);

CREATE INDEX IF NOT EXISTS idx_frontline_commands_job
ON frontline_commands(work_order_id, server_received_at);

CREATE INDEX IF NOT EXISTS idx_frontline_commands_payload
ON frontline_commands USING GIN (payload);

CREATE TABLE IF NOT EXISTS frontline_attachment_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frontline_device_id UUID NOT NULL REFERENCES frontline_devices(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
    frontline_command_id UUID REFERENCES frontline_commands(id) ON DELETE SET NULL,
    client_attachment_id TEXT NOT NULL,
    upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        upload_status IN (
            'pending',
            'uploading',
            'uploaded',
            'verified',
            'attached',
            'failed',
            'cancelled'
        )
    ),
    file_name TEXT NOT NULL,
    content_type TEXT,
    content_length BIGINT CHECK (content_length IS NULL OR content_length >= 0),
    content_hash TEXT,
    storage_upload_key TEXT,
    completed_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    byte_offset BIGINT NOT NULL DEFAULT 0 CHECK (byte_offset >= 0),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    captured_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (frontline_device_id, client_attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_frontline_attachment_uploads_device_status
ON frontline_attachment_uploads(frontline_device_id, upload_status);

CREATE INDEX IF NOT EXISTS idx_frontline_attachment_uploads_job
ON frontline_attachment_uploads(work_order_id);

CREATE TABLE IF NOT EXISTS frontline_sync_changes (
    change_sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'revoke')),
    row_version BIGINT NOT NULL,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
    audience_employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    audience_role TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    available_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frontline_sync_changes_employee_sequence
ON frontline_sync_changes(audience_employee_id, change_sequence);

CREATE INDEX IF NOT EXISTS idx_frontline_sync_changes_job_sequence
ON frontline_sync_changes(work_order_id, change_sequence);

CREATE INDEX IF NOT EXISTS idx_frontline_sync_changes_available
ON frontline_sync_changes(available_at, expires_at);

CREATE TABLE IF NOT EXISTS frontline_sync_cursors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frontline_device_id UUID NOT NULL REFERENCES frontline_devices(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cursor_name TEXT NOT NULL DEFAULT 'default',
    last_change_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_change_sequence >= 0),
    last_pull_at TIMESTAMP,
    last_push_at TIMESTAMP,
    last_success_at TIMESTAMP,
    last_error_at TIMESTAMP,
    last_error TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (frontline_device_id, employee_id, cursor_name)
);

CREATE INDEX IF NOT EXISTS idx_frontline_sync_cursors_employee
ON frontline_sync_cursors(employee_id, last_success_at);

CREATE TABLE IF NOT EXISTS frontline_sync_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frontline_command_id UUID NOT NULL REFERENCES frontline_commands(id) ON DELETE CASCADE,
    frontline_device_id UUID NOT NULL REFERENCES frontline_devices(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID,
    conflict_type TEXT NOT NULL CHECK (
        conflict_type IN (
            'version_mismatch',
            'invalid_transition',
            'assignment_revoked',
            'package_superseded',
            'record_deleted',
            'authorization',
            'duplicate',
            'other'
        )
    ),
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'client_action_required', 'resolved_server', 'resolved_client', 'ignored')
    ),
    server_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolution JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolved_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    detected_at TIMESTAMP NOT NULL DEFAULT now(),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frontline_sync_conflicts_device_status
ON frontline_sync_conflicts(frontline_device_id, status, detected_at);

CREATE INDEX IF NOT EXISTS idx_frontline_sync_conflicts_job
ON frontline_sync_conflicts(work_order_id, status);

CREATE TABLE IF NOT EXISTS frontline_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frontline_device_id UUID NOT NULL REFERENCES frontline_devices(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('web_push', 'apns', 'fcm', 'other')),
    endpoint_hash TEXT NOT NULL UNIQUE,
    encrypted_subscription JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'expired', 'revoked', 'failed')
    ),
    last_success_at TIMESTAMP,
    last_failure_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_frontline_push_subscriptions_device
ON frontline_push_subscriptions(frontline_device_id, status);

ALTER TABLE form_submissions
ADD COLUMN IF NOT EXISTS frontline_device_id UUID REFERENCES frontline_devices(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS frontline_command_id UUID REFERENCES frontline_commands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_submissions_frontline_device
ON form_submissions(frontline_device_id, received_at);

ALTER TABLE job_execution_events
ADD COLUMN IF NOT EXISTS frontline_device_id UUID REFERENCES frontline_devices(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS frontline_command_id UUID REFERENCES frontline_commands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_execution_events_frontline_device
ON job_execution_events(frontline_device_id, server_received_at);

CREATE OR REPLACE VIEW frontline_device_health_view AS
SELECT
    fd.id AS frontline_device_id,
    fd.device_identifier,
    fd.display_name,
    fd.platform,
    fd.app_version,
    fd.registration_status,
    fda.employee_id,
    e.employee_number,
    e.display_name AS employee_name,
    fd.last_seen_at,
    cursor_state.last_success_at,
    cursor_state.last_pull_at,
    cursor_state.last_push_at,
    cursor_state.last_change_sequence,
    command_state.pending_command_count,
    command_state.failed_command_count,
    upload_state.pending_upload_count,
    upload_state.failed_upload_count,
    conflict_state.open_conflict_count
FROM frontline_devices fd
LEFT JOIN frontline_device_assignments fda
    ON fda.frontline_device_id = fd.id
    AND fda.assignment_status = 'active'
    AND fda.deleted_at IS NULL
LEFT JOIN employees e ON e.id = fda.employee_id
LEFT JOIN LATERAL (
    SELECT
        MAX(fsc.last_success_at) AS last_success_at,
        MAX(fsc.last_pull_at) AS last_pull_at,
        MAX(fsc.last_push_at) AS last_push_at,
        MAX(fsc.last_change_sequence) AS last_change_sequence
    FROM frontline_sync_cursors fsc
    WHERE fsc.frontline_device_id = fd.id
) cursor_state ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (
            WHERE fc.processing_status IN ('received', 'validating', 'retry')
        ) AS pending_command_count,
        COUNT(*) FILTER (
            WHERE fc.processing_status IN ('rejected', 'conflict')
        ) AS failed_command_count
    FROM frontline_commands fc
    WHERE fc.frontline_device_id = fd.id
) command_state ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (
            WHERE fau.upload_status IN ('pending', 'uploading', 'uploaded')
        ) AS pending_upload_count,
        COUNT(*) FILTER (WHERE fau.upload_status = 'failed') AS failed_upload_count
    FROM frontline_attachment_uploads fau
    WHERE fau.frontline_device_id = fd.id
) upload_state ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE fsc.status = 'open') AS open_conflict_count
    FROM frontline_sync_conflicts fsc
    WHERE fsc.frontline_device_id = fd.id
) conflict_state ON true
WHERE fd.deleted_at IS NULL;
