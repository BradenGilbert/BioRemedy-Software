CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Job execution instances and typed field outputs.
-- Definitions remain reusable templates; these records are the frozen,
-- auditable execution plan and results for one dispatched job.

CREATE TABLE IF NOT EXISTS job_step_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    step_definition_id UUID REFERENCES job_step_definitions(id) ON DELETE SET NULL,
    step_key TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    description_snapshot TEXT,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    required BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        status IN (
            'not_started',
            'available',
            'in_progress',
            'blocked',
            'complete',
            'skipped',
            'cancelled'
        )
    ),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    completed_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    reopened_at TIMESTAMP,
    reopened_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    row_version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (work_order_id, step_key),
    UNIQUE (work_order_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_job_step_instances_job
ON job_step_instances(work_order_id, sequence, status);

CREATE TABLE IF NOT EXISTS job_action_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_step_instance_id UUID NOT NULL REFERENCES job_step_instances(id) ON DELETE CASCADE,
    action_definition_id UUID REFERENCES job_action_definitions(id) ON DELETE SET NULL,
    action_key TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    description_snapshot TEXT,
    action_type TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    required BOOLEAN NOT NULL DEFAULT true,
    allow_skip BOOLEAN NOT NULL DEFAULT false,
    allow_repeat BOOLEAN NOT NULL DEFAULT false,
    assignee_scope TEXT NOT NULL DEFAULT 'any_assigned_worker',
    assignee_role TEXT,
    assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        status IN (
            'not_started',
            'available',
            'in_progress',
            'blocked',
            'awaiting_approval',
            'complete',
            'skipped',
            'failed',
            'cancelled'
        )
    ),
    completion_count INTEGER NOT NULL DEFAULT 0 CHECK (completion_count >= 0),
    started_at TIMESTAMP,
    started_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    completed_at TIMESTAMP,
    completed_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    skipped_at TIMESTAMP,
    skipped_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    skip_reason TEXT,
    completion_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_step_instance_id, action_key),
    UNIQUE (job_step_instance_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_job_action_instances_job_status
ON job_action_instances(work_order_id, status);

CREATE INDEX IF NOT EXISTS idx_job_action_instances_step
ON job_action_instances(job_step_instance_id, sequence);

CREATE INDEX IF NOT EXISTS idx_job_action_instances_assignee
ON job_action_instances(assigned_employee_id, status)
WHERE assigned_employee_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS job_action_instance_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_action_instance_id UUID NOT NULL REFERENCES job_action_instances(id) ON DELETE CASCADE,
    depends_on_action_instance_id UUID NOT NULL REFERENCES job_action_instances(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'completed',
    condition_expression JSONB,
    satisfied_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_action_instance_id, depends_on_action_instance_id),
    CHECK (job_action_instance_id <> depends_on_action_instance_id)
);

CREATE INDEX IF NOT EXISTS idx_job_action_instance_dependencies_target
ON job_action_instance_dependencies(depends_on_action_instance_id);

CREATE TABLE IF NOT EXISTS form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    job_assignment_id UUID REFERENCES job_assignments(id) ON DELETE SET NULL,
    form_version_id UUID NOT NULL REFERENCES form_versions(id),
    submission_number INTEGER NOT NULL DEFAULT 1 CHECK (submission_number > 0),
    revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN (
            'draft',
            'submitted',
            'needs_correction',
            'approved',
            'rejected',
            'superseded',
            'void'
        )
    ),
    submitted_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    submitted_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMP,
    approved_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    captured_at TIMESTAMP,
    received_at TIMESTAMP NOT NULL DEFAULT now(),
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    gps_accuracy_meters NUMERIC(8,2),
    source TEXT NOT NULL DEFAULT 'erp' CHECK (
        source IN ('erp', 'frontline', 'import', 'integration')
    ),
    source_device_identifier TEXT,
    client_record_id TEXT,
    idempotency_key TEXT,
    validation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_action_instance_id, form_version_id, submission_number, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_job
ON form_submissions(work_order_id, status);

CREATE INDEX IF NOT EXISTS idx_form_submissions_action
ON form_submissions(job_action_instance_id, form_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submissions_idempotency
ON form_submissions(idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS form_submission_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
    form_field_id UUID REFERENCES form_fields(id) ON DELETE SET NULL,
    field_key_snapshot TEXT NOT NULL,
    field_label_snapshot TEXT,
    repeat_group_key TEXT,
    repeat_index INTEGER NOT NULL DEFAULT 0 CHECK (repeat_index >= 0),
    value_type TEXT NOT NULL CHECK (
        value_type IN (
            'null',
            'text',
            'integer',
            'decimal',
            'boolean',
            'date',
            'time',
            'datetime',
            'json',
            'reference',
            'file'
        )
    ),
    text_value TEXT,
    integer_value BIGINT,
    decimal_value NUMERIC(18,6),
    boolean_value BOOLEAN,
    date_value DATE,
    time_value TIME,
    timestamp_value TIMESTAMP,
    json_value JSONB,
    reference_entity TEXT,
    reference_id UUID,
    file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    display_value TEXT,
    captured_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (form_submission_id, field_key_snapshot, repeat_group_key, repeat_index)
);

CREATE INDEX IF NOT EXISTS idx_form_submission_values_submission
ON form_submission_values(form_submission_id);

CREATE INDEX IF NOT EXISTS idx_form_submission_values_reference
ON form_submission_values(reference_entity, reference_id);

CREATE INDEX IF NOT EXISTS idx_form_submission_values_json
ON form_submission_values USING GIN (json_value);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submission_values_answer
ON form_submission_values(
    form_submission_id,
    field_key_snapshot,
    coalesce(repeat_group_key, ''),
    repeat_index
)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS form_output_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
    form_output_mapping_id UUID NOT NULL REFERENCES form_output_mappings(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'processing', 'succeeded', 'failed', 'skipped')
    ),
    target_entity TEXT NOT NULL,
    target_record_id UUID,
    idempotency_key TEXT NOT NULL UNIQUE,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_detail TEXT,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_output_executions_submission
ON form_output_executions(form_submission_id, status);

CREATE TABLE IF NOT EXISTS job_execution_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_step_instance_id UUID REFERENCES job_step_instances(id) ON DELETE SET NULL,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
    job_assignment_id UUID REFERENCES job_assignments(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    event_name TEXT NOT NULL,
    actor_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'erp' CHECK (
        source IN ('erp', 'frontline', 'system', 'import', 'integration')
    ),
    source_device_identifier TEXT,
    client_captured_at TIMESTAMP,
    server_received_at TIMESTAMP NOT NULL DEFAULT now(),
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    gps_accuracy_meters NUMERIC(8,2),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_execution_events_job_sequence
ON job_execution_events(work_order_id, event_sequence);

CREATE INDEX IF NOT EXISTS idx_job_execution_events_action
ON job_execution_events(job_action_instance_id, event_sequence);

CREATE INDEX IF NOT EXISTS idx_job_execution_events_type
ON job_execution_events(event_type, server_received_at);

CREATE INDEX IF NOT EXISTS idx_job_execution_events_payload
ON job_execution_events USING GIN (payload);

CREATE TABLE IF NOT EXISTS job_time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_assignment_id UUID REFERENCES job_assignments(id) ON DELETE SET NULL,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    entry_type TEXT NOT NULL CHECK (
        entry_type IN ('travel', 'work', 'break', 'standby', 'training', 'other')
    ),
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
    source TEXT NOT NULL DEFAULT 'frontline',
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'submitted', 'approved', 'rejected', 'void')
    ),
    approved_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    notes TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_job_time_entries_job
ON job_time_entries(work_order_id, entry_type);

CREATE INDEX IF NOT EXISTS idx_job_time_entries_employee_time
ON job_time_entries(employee_id, started_at, ended_at);

CREATE TABLE IF NOT EXISTS job_mileage_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_assignment_id UUID REFERENCES job_assignments(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,
    mileage_type TEXT NOT NULL DEFAULT 'job' CHECK (
        mileage_type IN ('travel_to', 'job', 'travel_from', 'other')
    ),
    beginning_odometer NUMERIC(12,2),
    ending_odometer NUMERIC(12,2),
    calculated_distance NUMERIC(12,2),
    captured_at TIMESTAMP,
    notes TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (
        ending_odometer IS NULL OR
        beginning_odometer IS NULL OR
        ending_odometer >= beginning_odometer
    )
);

CREATE INDEX IF NOT EXISTS idx_job_mileage_entries_job
ON job_mileage_entries(work_order_id);

CREATE TABLE IF NOT EXISTS job_material_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    job_resource_allocation_id UUID REFERENCES job_resource_allocations(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name_snapshot TEXT NOT NULL,
    quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
    unit_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    lot_number TEXT,
    used_at TIMESTAMP NOT NULL DEFAULT now(),
    billable BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_material_usage_job
ON job_material_usage(work_order_id, used_at);

CREATE INDEX IF NOT EXISTS idx_job_material_usage_product
ON job_material_usage(product_id);

CREATE TABLE IF NOT EXISTS job_equipment_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    job_resource_allocation_id UUID REFERENCES job_resource_allocations(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,
    equipment_name_snapshot TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    meter_start NUMERIC(18,2),
    meter_end NUMERIC(18,2),
    usage_quantity NUMERIC(18,4),
    usage_unit TEXT,
    billable BOOLEAN NOT NULL DEFAULT true,
    condition_out TEXT,
    damage_or_issue_reported BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    CHECK (meter_end IS NULL OR meter_start IS NULL OR meter_end >= meter_start)
);

CREATE INDEX IF NOT EXISTS idx_job_equipment_usage_job
ON job_equipment_usage(work_order_id, started_at);

CREATE INDEX IF NOT EXISTS idx_job_equipment_usage_equipment
ON job_equipment_usage(equipment_id, started_at, ended_at);

CREATE TABLE IF NOT EXISTS job_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (
        media_type IN ('photo', 'video', 'audio', 'scan', 'other')
    ),
    caption TEXT,
    captured_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    captured_at TIMESTAMP,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    gps_accuracy_meters NUMERIC(8,2),
    report_section_key TEXT,
    customer_visible BOOLEAN NOT NULL DEFAULT false,
    sequence INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_media_job_time
ON job_media(work_order_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_job_media_action
ON job_media(job_action_instance_id);

CREATE TABLE IF NOT EXISTS job_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
    signature_type TEXT NOT NULL CHECK (
        signature_type IN (
            'customer_authorization',
            'customer_completion',
            'worker',
            'supervisor',
            'waste',
            'other'
        )
    ),
    signer_name TEXT NOT NULL,
    signer_title TEXT,
    signer_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    signature_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    signed_at TIMESTAMP NOT NULL,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    attestation_text TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_signatures_job
ON job_signatures(work_order_id, signature_type);

CREATE TABLE IF NOT EXISTS job_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
    exception_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('information', 'warning', 'blocking', 'critical')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'acknowledged', 'resolved', 'waived', 'cancelled')
    ),
    title TEXT NOT NULL,
    detail TEXT,
    raised_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    raised_at TIMESTAMP NOT NULL DEFAULT now(),
    assigned_to_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    resolved_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    resolution TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_exceptions_job_status
ON job_exceptions(work_order_id, status, severity);

CREATE TABLE IF NOT EXISTS job_waste_containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
    container_identifier TEXT NOT NULL,
    container_type TEXT,
    waste_profile TEXT,
    material_description TEXT,
    quantity NUMERIC(18,4),
    unit_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    generator_name_snapshot TEXT,
    generator_epa_id TEXT,
    status TEXT NOT NULL DEFAULT 'generated' CHECK (
        status IN (
            'planned',
            'generated',
            'staged',
            'in_transit',
            'received',
            'disposed',
            'returned',
            'cancelled'
        )
    ),
    generated_at TIMESTAMP,
    sealed_at TIMESTAMP,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    notes TEXT,
    form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (work_order_id, container_identifier)
);

CREATE INDEX IF NOT EXISTS idx_job_waste_containers_job
ON job_waste_containers(work_order_id, status);

CREATE TABLE IF NOT EXISTS job_waste_shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    shipment_number TEXT,
    manifest_number TEXT,
    transporter_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    destination_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    destination_location_text TEXT,
    departed_at TIMESTAMP,
    received_at TIMESTAMP,
    disposed_at TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (
        status IN ('planned', 'in_transit', 'received', 'disposed', 'exception', 'cancelled')
    ),
    manifest_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    bill_of_lading_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_waste_shipments_job
ON job_waste_shipments(work_order_id, status);

CREATE TABLE IF NOT EXISTS job_waste_shipment_containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_waste_shipment_id UUID NOT NULL REFERENCES job_waste_shipments(id) ON DELETE CASCADE,
    job_waste_container_id UUID NOT NULL REFERENCES job_waste_containers(id) ON DELETE CASCADE,
    loaded_at TIMESTAMP,
    received_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (job_waste_shipment_id, job_waste_container_id)
);

CREATE TABLE IF NOT EXISTS job_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    vendor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    vendor_name_snapshot TEXT,
    receipt_date DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    description TEXT,
    file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    billable BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (
        status IN ('draft', 'submitted', 'approved', 'rejected', 'void')
    ),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_receipts_job
ON job_receipts(work_order_id, receipt_date);

ALTER TABLE sampling_sessions
ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sampling_sessions_work_order
ON sampling_sessions(work_order_id);

ALTER TABLE project_samples
ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS job_action_instance_id UUID REFERENCES job_action_instances(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_samples_work_order
ON project_samples(work_order_id);

CREATE INDEX IF NOT EXISTS idx_project_samples_action
ON project_samples(job_action_instance_id);

CREATE OR REPLACE VIEW job_execution_progress_view AS
SELECT
    wo.id AS work_order_id,
    wo.job_number,
    wo.name AS job_name,
    wo.status AS job_status,
    step_totals.total_steps,
    step_totals.completed_steps,
    action_totals.total_actions,
    action_totals.completed_actions,
    action_totals.blocked_actions,
    submission_totals.draft_submissions,
    submission_totals.submitted_submissions,
    exception_totals.open_exceptions,
    exception_totals.blocking_exceptions,
    CASE
        WHEN coalesce(action_totals.total_actions, 0) = 0 THEN 0
        ELSE round(
            100.0 * coalesce(action_totals.completed_actions, 0) /
            action_totals.total_actions
        )::integer
    END AS completion_percent,
    wo.updated_at
FROM work_orders wo
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_steps,
        COUNT(*) FILTER (WHERE jsi.status IN ('complete', 'skipped')) AS completed_steps
    FROM job_step_instances jsi
    WHERE jsi.work_order_id = wo.id AND jsi.deleted_at IS NULL
) step_totals ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_actions,
        COUNT(*) FILTER (WHERE jai.status IN ('complete', 'skipped')) AS completed_actions,
        COUNT(*) FILTER (WHERE jai.status IN ('blocked', 'failed')) AS blocked_actions
    FROM job_action_instances jai
    WHERE jai.work_order_id = wo.id AND jai.deleted_at IS NULL
) action_totals ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE fs.status = 'draft') AS draft_submissions,
        COUNT(*) FILTER (WHERE fs.status IN ('submitted', 'approved')) AS submitted_submissions
    FROM form_submissions fs
    WHERE fs.work_order_id = wo.id AND fs.deleted_at IS NULL
) submission_totals ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE je.status = 'open') AS open_exceptions,
        COUNT(*) FILTER (
            WHERE je.status = 'open' AND je.severity IN ('blocking', 'critical')
        ) AS blocking_exceptions
    FROM job_exceptions je
    WHERE je.work_order_id = wo.id AND je.deleted_at IS NULL
) exception_totals ON true
WHERE wo.deleted_at IS NULL;
