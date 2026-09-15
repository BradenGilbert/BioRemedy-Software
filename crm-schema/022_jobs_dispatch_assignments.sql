CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Sales-to-dispatch intake and first-class dispatchable jobs.
-- work_orders is retained as the durable job identity. projects remain the
-- overall customer engagement and tasks remain office follow-up work.

CREATE TABLE IF NOT EXISTS job_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number TEXT NOT NULL UNIQUE,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    job_site_id UUID REFERENCES job_sites(id) ON DELETE SET NULL,
    quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
    price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,
    received_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    requested_by_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    source_channel TEXT NOT NULL DEFAULT 'phone' CHECK (
        source_channel IN ('phone', 'email', 'portal', 'sales', 'internal', 'other')
    ),
    request_status TEXT NOT NULL DEFAULT 'submitted' CHECK (
        request_status IN (
            'draft',
            'submitted',
            'dispatch_review',
            'accepted',
            'needs_information',
            'declined',
            'converted',
            'cancelled'
        )
    ),
    service_category TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    received_at TIMESTAMP NOT NULL DEFAULT now(),
    requested_service_at TIMESTAMP,
    requested_time_text TEXT,
    estimated_duration_minutes INTEGER CHECK (
        estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0
    ),
    customer_po_number TEXT,
    bioremedy_po_number TEXT,
    generator_responsible_party TEXT,
    called_in_by_name TEXT,
    called_in_by_phone TEXT,
    onsite_contact_name TEXT,
    onsite_contact_phone TEXT,
    address_text TEXT,
    map_pin_text TEXT,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    description TEXT NOT NULL,
    equipment_notes TEXT,
    labor_notes TEXT,
    vendor_notes TEXT,
    pricing_notes TEXT,
    customer_packet_status TEXT,
    internal_notes TEXT,
    submitted_at TIMESTAMP,
    accepted_at TIMESTAMP,
    converted_at TIMESTAMP,
    converted_work_order_id UUID,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    updated_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_requests_status_received
ON job_requests(request_status, received_at);

CREATE INDEX IF NOT EXISTS idx_job_requests_account
ON job_requests(account_id);

CREATE INDEX IF NOT EXISTS idx_job_requests_project
ON job_requests(project_id);

CREATE INDEX IF NOT EXISTS idx_job_requests_requested_service
ON job_requests(requested_service_at);

CREATE TABLE IF NOT EXISTS job_request_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_request_id UUID NOT NULL REFERENCES job_requests(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    document_role TEXT NOT NULL CHECK (
        document_role IN (
            'customer_packet',
            'quote',
            'purchase_order',
            'site_document',
            'photo',
            'email',
            'other'
        )
    ),
    required_for_acceptance BOOLEAN NOT NULL DEFAULT false,
    reviewed_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_request_id, file_id, document_role)
);

CREATE INDEX IF NOT EXISTS idx_job_request_documents_request
ON job_request_documents(job_request_id, document_role);

CREATE TABLE IF NOT EXISTS job_status_definitions (
    status_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    sequence INTEGER NOT NULL UNIQUE,
    category TEXT NOT NULL CHECK (
        category IN ('intake', 'planning', 'dispatch', 'field', 'review', 'terminal')
    ),
    terminal BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO job_status_definitions (
    status_code,
    display_name,
    sequence,
    category,
    terminal
)
VALUES
    ('request_submitted', 'Request Submitted', 10, 'intake', false),
    ('dispatch_review', 'Dispatch Review', 20, 'planning', false),
    ('draft', 'Job Draft', 30, 'planning', false),
    ('ready', 'Ready to Schedule', 40, 'planning', false),
    ('scheduled', 'Scheduled', 50, 'dispatch', false),
    ('dispatched', 'Dispatched', 60, 'dispatch', false),
    ('acknowledged', 'Acknowledged', 70, 'field', false),
    ('en_route', 'En Route', 80, 'field', false),
    ('on_site', 'On Site', 90, 'field', false),
    ('in_progress', 'In Progress', 100, 'field', false),
    ('paused', 'Paused', 110, 'field', false),
    ('field_complete', 'Field Complete', 120, 'review', false),
    ('office_review', 'Office Review', 130, 'review', false),
    ('closed', 'Closed', 140, 'terminal', true),
    ('cancelled', 'Cancelled', 150, 'terminal', true)
ON CONFLICT (status_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS job_status_transition_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_status_code TEXT NOT NULL REFERENCES job_status_definitions(status_code),
    to_status_code TEXT NOT NULL REFERENCES job_status_definitions(status_code),
    actor_scope TEXT NOT NULL DEFAULT 'authorized_user',
    requires_reason BOOLEAN NOT NULL DEFAULT false,
    requires_online_validation BOOLEAN NOT NULL DEFAULT false,
    validation_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (from_status_code, to_status_code, actor_scope),
    CHECK (from_status_code <> to_status_code)
);

INSERT INTO job_status_transition_rules (
    from_status_code,
    to_status_code,
    actor_scope,
    requires_reason,
    requires_online_validation
)
VALUES
    ('request_submitted', 'dispatch_review', 'dispatcher', false, false),
    ('dispatch_review', 'draft', 'dispatcher', false, false),
    ('draft', 'ready', 'dispatcher', false, true),
    ('ready', 'scheduled', 'dispatcher', false, true),
    ('scheduled', 'dispatched', 'dispatcher', false, true),
    ('dispatched', 'acknowledged', 'assigned_worker', false, false),
    ('acknowledged', 'en_route', 'assigned_worker', false, false),
    ('en_route', 'on_site', 'assigned_worker', false, false),
    ('on_site', 'in_progress', 'assigned_worker', false, false),
    ('in_progress', 'paused', 'assigned_worker', true, false),
    ('paused', 'in_progress', 'assigned_worker', false, false),
    ('in_progress', 'field_complete', 'field_lead', false, true),
    ('field_complete', 'office_review', 'office_reviewer', false, true),
    ('field_complete', 'in_progress', 'office_reviewer', true, true),
    ('office_review', 'field_complete', 'office_reviewer', true, true),
    ('office_review', 'closed', 'office_reviewer', false, true),
    ('ready', 'draft', 'dispatcher', true, false),
    ('scheduled', 'ready', 'dispatcher', true, true),
    ('draft', 'cancelled', 'dispatcher', true, false),
    ('ready', 'cancelled', 'dispatcher', true, false),
    ('scheduled', 'cancelled', 'dispatcher', true, true),
    ('dispatched', 'cancelled', 'dispatcher', true, true)
ON CONFLICT (from_status_code, to_status_code, actor_scope) DO NOTHING;

ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS job_number TEXT,
ADD COLUMN IF NOT EXISTS job_request_id UUID REFERENCES job_requests(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS job_site_id UUID REFERENCES job_sites(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS job_type_version_id UUID REFERENCES job_type_versions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS requested_by_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS dispatcher_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS field_lead_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN IF NOT EXISTS requested_service_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS schedule_timezone TEXT NOT NULL DEFAULT 'America/Chicago',
ADD COLUMN IF NOT EXISTS dispatch_status TEXT NOT NULL DEFAULT 'unassigned',
ADD COLUMN IF NOT EXISTS office_review_status TEXT NOT NULL DEFAULT 'not_ready',
ADD COLUMN IF NOT EXISTS customer_po_number TEXT,
ADD COLUMN IF NOT EXISTS bioremedy_po_number TEXT,
ADD COLUMN IF NOT EXISTS generator_responsible_party TEXT,
ADD COLUMN IF NOT EXISTS called_in_by_name TEXT,
ADD COLUMN IF NOT EXISTS called_in_by_phone TEXT,
ADD COLUMN IF NOT EXISTS onsite_contact_name TEXT,
ADD COLUMN IF NOT EXISTS onsite_contact_phone TEXT,
ADD COLUMN IF NOT EXISTS job_description TEXT,
ADD COLUMN IF NOT EXISTS dispatch_instructions TEXT,
ADD COLUMN IF NOT EXISTS field_instructions TEXT,
ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS actual_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS actual_completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS customer_signature_required BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS office_review_required BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS job_package_version INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_job_number
ON work_orders(job_number)
WHERE job_number IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_job_request
ON work_orders(job_request_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_account
ON work_orders(account_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_job_site
ON work_orders(job_site_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_job_type_version
ON work_orders(job_type_version_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_dispatch_status
ON work_orders(dispatch_status, status);

CREATE INDEX IF NOT EXISTS idx_work_orders_requested_service_at
ON work_orders(requested_service_at);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_job_requests_converted_work_order'
          AND conrelid = 'job_requests'::regclass
    ) THEN
        ALTER TABLE job_requests
        ADD CONSTRAINT fk_job_requests_converted_work_order
        FOREIGN KEY (converted_work_order_id)
        REFERENCES work_orders(id)
        ON DELETE SET NULL;
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS job_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    contact_role TEXT NOT NULL CHECK (
        contact_role IN (
            'requested_by',
            'called_in_by',
            'onsite_poc',
            'generator_rp',
            'billing',
            'approver',
            'other'
        )
    ),
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    name_snapshot TEXT NOT NULL,
    organization_snapshot TEXT,
    phone_snapshot TEXT,
    email_snapshot TEXT,
    instructions TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_contacts_job_role
ON job_contacts(work_order_id, contact_role);

CREATE TABLE IF NOT EXISTS job_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    location_role TEXT NOT NULL DEFAULT 'service' CHECK (
        location_role IN ('service', 'staging', 'pickup', 'disposal', 'laboratory', 'other')
    ),
    job_site_id UUID REFERENCES job_sites(id) ON DELETE SET NULL,
    name_snapshot TEXT,
    address_line_one TEXT,
    address_line_two TEXT,
    city TEXT,
    state_or_province TEXT,
    postal_code TEXT,
    country TEXT NOT NULL DEFAULT 'US',
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    map_pin_text TEXT,
    access_instructions TEXT,
    site_contact_snapshot TEXT,
    timezone TEXT NOT NULL DEFAULT 'America/Chicago',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    snapshot_captured_at TIMESTAMP NOT NULL DEFAULT now(),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_locations_job
ON job_locations(work_order_id, location_role);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_locations_primary
ON job_locations(work_order_id)
WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_locations_geo
ON job_locations(latitude, longitude);

CREATE TABLE IF NOT EXISTS job_schedule_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    segment_type TEXT NOT NULL DEFAULT 'work' CHECK (
        segment_type IN ('travel_to', 'work', 'break', 'travel_from', 'standby', 'other')
    ),
    segment_name TEXT,
    sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
    planned_start TIMESTAMP NOT NULL,
    planned_end TIMESTAMP NOT NULL,
    actual_start TIMESTAMP,
    actual_end TIMESTAMP,
    timezone TEXT NOT NULL DEFAULT 'America/Chicago',
    status TEXT NOT NULL DEFAULT 'planned' CHECK (
        status IN ('planned', 'confirmed', 'in_progress', 'completed', 'cancelled')
    ),
    locked_for_dispatch BOOLEAN NOT NULL DEFAULT false,
    location_id UUID REFERENCES job_locations(id) ON DELETE SET NULL,
    notes TEXT,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    updated_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (work_order_id, sequence),
    CHECK (planned_end > planned_start),
    CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start)
);

CREATE INDEX IF NOT EXISTS idx_job_schedule_segments_time
ON job_schedule_segments(planned_start, planned_end, status);

CREATE INDEX IF NOT EXISTS idx_job_schedule_segments_job
ON job_schedule_segments(work_order_id, sequence);

CREATE TABLE IF NOT EXISTS job_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    schedule_segment_id UUID REFERENCES job_schedule_segments(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    crew_id UUID REFERENCES crews(id) ON DELETE SET NULL,
    assignment_role TEXT NOT NULL DEFAULT 'technician',
    is_field_lead BOOLEAN NOT NULL DEFAULT false,
    assignment_status TEXT NOT NULL DEFAULT 'proposed' CHECK (
        assignment_status IN (
            'proposed',
            'assigned',
            'dispatched',
            'acknowledged',
            'declined',
            'en_route',
            'on_site',
            'working',
            'complete',
            'released',
            'cancelled'
        )
    ),
    planned_start TIMESTAMP,
    planned_end TIMESTAMP,
    acknowledged_at TIMESTAMP,
    dispatched_at TIMESTAMP,
    released_at TIMESTAMP,
    eligibility_status TEXT NOT NULL DEFAULT 'not_checked' CHECK (
        eligibility_status IN ('not_checked', 'eligible', 'warning', 'blocked', 'overridden')
    ),
    eligibility_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    eligibility_checked_at TIMESTAMP,
    eligibility_checked_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    override_reason TEXT,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (employee_id IS NOT NULL OR crew_id IS NOT NULL),
    CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end > planned_start)
);

CREATE INDEX IF NOT EXISTS idx_job_assignments_job
ON job_assignments(work_order_id, assignment_status);

CREATE INDEX IF NOT EXISTS idx_job_assignments_employee_time
ON job_assignments(employee_id, planned_start, planned_end)
WHERE employee_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_assignments_crew_time
ON job_assignments(crew_id, planned_start, planned_end)
WHERE crew_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_assignments_employee_segment
ON job_assignments(work_order_id, employee_id, schedule_segment_id)
WHERE employee_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_assignments_employee_job
ON job_assignments(work_order_id, employee_id)
WHERE employee_id IS NOT NULL
  AND schedule_segment_id IS NULL
  AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_assignments_crew_job
ON job_assignments(work_order_id, crew_id)
WHERE crew_id IS NOT NULL
  AND schedule_segment_id IS NULL
  AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS job_resource_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    schedule_segment_id UUID REFERENCES job_schedule_segments(id) ON DELETE SET NULL,
    resource_type TEXT NOT NULL CHECK (
        resource_type IN ('vehicle', 'equipment', 'material', 'vendor', 'facility', 'other')
    ),
    equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    vendor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    resource_name_snapshot TEXT,
    quantity_planned NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (quantity_planned > 0),
    unit_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    allocation_status TEXT NOT NULL DEFAULT 'requested' CHECK (
        allocation_status IN (
            'requested',
            'reserved',
            'assigned',
            'issued',
            'returned',
            'consumed',
            'cancelled'
        )
    ),
    planned_start TIMESTAMP,
    planned_end TIMESTAMP,
    issued_at TIMESTAMP,
    returned_at TIMESTAMP,
    notes TEXT,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (
        equipment_id IS NOT NULL OR
        product_id IS NOT NULL OR
        vendor_account_id IS NOT NULL OR
        resource_name_snapshot IS NOT NULL
    ),
    CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end > planned_start)
);

CREATE INDEX IF NOT EXISTS idx_job_resource_allocations_job
ON job_resource_allocations(work_order_id, resource_type, allocation_status);

CREATE INDEX IF NOT EXISTS idx_job_resource_allocations_equipment_time
ON job_resource_allocations(equipment_id, planned_start, planned_end)
WHERE equipment_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS job_schedule_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_assignment_id UUID REFERENCES job_assignments(id) ON DELETE CASCADE,
    resource_allocation_id UUID REFERENCES job_resource_allocations(id) ON DELETE CASCADE,
    conflict_type TEXT NOT NULL CHECK (
        conflict_type IN (
            'employee_overlap',
            'crew_overlap',
            'equipment_overlap',
            'unavailable',
            'expired_credential',
            'missing_certification',
            'missing_skill',
            'equipment_hold',
            'travel_time',
            'hours_limit',
            'other'
        )
    ),
    severity TEXT NOT NULL CHECK (severity IN ('information', 'warning', 'blocking')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'acknowledged', 'resolved', 'overridden')
    ),
    title TEXT NOT NULL,
    detail TEXT,
    detected_at TIMESTAMP NOT NULL DEFAULT now(),
    resolved_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    resolution_notes TEXT,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_schedule_conflicts_job_status
ON job_schedule_conflicts(work_order_id, status, severity);

CREATE TABLE IF NOT EXISTS dispatch_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    job_assignment_id UUID REFERENCES job_assignments(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'request_received',
            'job_created',
            'schedule_changed',
            'assignment_changed',
            'resource_changed',
            'eligibility_checked',
            'conflict_detected',
            'status_changed',
            'dispatch_sent',
            'dispatch_acknowledged',
            'override',
            'note'
        )
    ),
    from_status TEXT,
    to_status TEXT,
    event_at TIMESTAMP NOT NULL DEFAULT now(),
    actor_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    actor_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_events_job_time
ON dispatch_events(work_order_id, event_at);

CREATE TABLE IF NOT EXISTS job_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    document_role TEXT NOT NULL CHECK (
        document_role IN (
            'customer_packet',
            'quote',
            'purchase_order',
            'work_plan',
            'safety_document',
            'site_document',
            'field_attachment',
            'report',
            'manifest',
            'receipt',
            'other'
        )
    ),
    visible_to_frontline BOOLEAN NOT NULL DEFAULT false,
    visible_to_customer BOOLEAN NOT NULL DEFAULT false,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (work_order_id, file_id, document_role)
);

CREATE INDEX IF NOT EXISTS idx_job_documents_job_role
ON job_documents(work_order_id, document_role);

CREATE OR REPLACE VIEW dispatch_board_view AS
SELECT
    wo.id AS work_order_id,
    wo.job_number,
    wo.project_id,
    p.name AS project_name,
    wo.account_id,
    acct.account_name,
    wo.job_site_id,
    js.name AS job_site_name,
    wo.name AS job_name,
    wo.status,
    wo.dispatch_status,
    wo.priority,
    wo.requested_service_at,
    schedule_window.planned_start,
    schedule_window.planned_end,
    wo.schedule_timezone,
    wo.field_lead_employee_id,
    field_lead.display_name AS field_lead_name,
    assignment_totals.worker_count,
    assignment_totals.acknowledged_count,
    resource_totals.resource_count,
    conflict_totals.open_conflict_count,
    conflict_totals.blocking_conflict_count,
    wo.office_review_status,
    wo.updated_at
FROM work_orders wo
LEFT JOIN projects p ON p.id = wo.project_id
LEFT JOIN accounts acct ON acct.id = wo.account_id
LEFT JOIN job_sites js ON js.id = wo.job_site_id
LEFT JOIN employees field_lead ON field_lead.id = wo.field_lead_employee_id
LEFT JOIN LATERAL (
    SELECT
        MIN(seg.planned_start) AS planned_start,
        MAX(seg.planned_end) AS planned_end
    FROM job_schedule_segments seg
    WHERE seg.work_order_id = wo.id
      AND seg.deleted_at IS NULL
      AND seg.status <> 'cancelled'
) schedule_window ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE ja.employee_id IS NOT NULL) AS worker_count,
        COUNT(*) FILTER (
            WHERE ja.employee_id IS NOT NULL
              AND ja.assignment_status IN (
                  'acknowledged',
                  'en_route',
                  'on_site',
                  'working',
                  'complete'
              )
        ) AS acknowledged_count
    FROM job_assignments ja
    WHERE ja.work_order_id = wo.id
      AND ja.deleted_at IS NULL
      AND ja.assignment_status <> 'cancelled'
) assignment_totals ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS resource_count
    FROM job_resource_allocations jra
    WHERE jra.work_order_id = wo.id
      AND jra.deleted_at IS NULL
      AND jra.allocation_status <> 'cancelled'
) resource_totals ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE jsc.status = 'open') AS open_conflict_count,
        COUNT(*) FILTER (
            WHERE jsc.status = 'open' AND jsc.severity = 'blocking'
        ) AS blocking_conflict_count
    FROM job_schedule_conflicts jsc
    WHERE jsc.work_order_id = wo.id
      AND jsc.deleted_at IS NULL
) conflict_totals ON true
WHERE wo.deleted_at IS NULL;
