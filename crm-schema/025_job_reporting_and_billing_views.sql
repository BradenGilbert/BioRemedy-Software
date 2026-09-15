CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Job cost, charge, review, and immutable report snapshots.
-- Reporting views are read models built from typed execution records.

CREATE TABLE IF NOT EXISTS job_cost_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    cost_category TEXT NOT NULL CHECK (
        cost_category IN (
            'labor',
            'material',
            'equipment',
            'vehicle',
            'vendor',
            'travel',
            'disposal',
            'receipt',
            'other'
        )
    ),
    source_entity TEXT,
    source_record_id UUID,
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    vendor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    service_date DATE,
    quantity NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    unit_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
    extended_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected', 'void')
    ),
    approved_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_cost_entries_job
ON job_cost_entries(work_order_id, cost_category, status);

CREATE INDEX IF NOT EXISTS idx_job_cost_entries_source
ON job_cost_entries(source_entity, source_record_id);

CREATE TABLE IF NOT EXISTS job_charge_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    charge_category TEXT NOT NULL CHECK (
        charge_category IN (
            'labor',
            'material',
            'equipment',
            'vehicle',
            'vendor',
            'travel',
            'disposal',
            'surcharge',
            'tax',
            'other'
        )
    ),
    source_entity TEXT,
    source_record_id UUID,
    quote_line_id UUID REFERENCES quote_lines(id) ON DELETE SET NULL,
    sales_order_line_id UUID REFERENCES sales_order_lines(id) ON DELETE SET NULL,
    invoice_line_id UUID REFERENCES invoice_lines(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    service_date DATE,
    quantity NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    unit_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    unit_price NUMERIC(14,4) NOT NULL DEFAULT 0,
    extended_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    rate_source TEXT,
    billable BOOLEAN NOT NULL DEFAULT true,
    billing_status TEXT NOT NULL DEFAULT 'candidate' CHECK (
        billing_status IN (
            'candidate',
            'review',
            'approved',
            'held',
            'invoiced',
            'rejected',
            'void'
        )
    ),
    approved_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_charge_entries_job
ON job_charge_entries(work_order_id, charge_category, billing_status);

CREATE INDEX IF NOT EXISTS idx_job_charge_entries_source
ON job_charge_entries(source_entity, source_record_id);

CREATE TABLE IF NOT EXISTS job_billing_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    review_status TEXT NOT NULL DEFAULT 'not_ready' CHECK (
        review_status IN (
            'not_ready',
            'ready',
            'in_review',
            'needs_correction',
            'approved',
            'exported',
            'closed'
        )
    ),
    assigned_to_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    requested_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    completed_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    hold_reason TEXT,
    review_notes TEXT,
    totals_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_billing_reviews_status
ON job_billing_reviews(review_status, assigned_to_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_billing_reviews_open
ON job_billing_reviews(work_order_id)
WHERE review_status NOT IN ('closed') AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS job_report_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    report_number TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    report_status TEXT NOT NULL DEFAULT 'generating' CHECK (
        report_status IN (
            'generating',
            'draft',
            'in_review',
            'approved',
            'issued',
            'superseded',
            'void',
            'failed'
        )
    ),
    report_template_key TEXT,
    source_through_event_sequence BIGINT,
    source_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_hash TEXT,
    output_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    generated_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    generated_at TIMESTAMP,
    approved_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    issued_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (work_order_id, version_number),
    UNIQUE (report_number, version_number)
);

CREATE INDEX IF NOT EXISTS idx_job_report_snapshots_job
ON job_report_snapshots(work_order_id, report_status, version_number);

CREATE TABLE IF NOT EXISTS job_report_section_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_report_snapshot_id UUID NOT NULL REFERENCES job_report_snapshots(id) ON DELETE CASCADE,
    section_key TEXT NOT NULL,
    title TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    source_entity TEXT,
    source_record_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    rendered_content JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (job_report_snapshot_id, section_key),
    UNIQUE (job_report_snapshot_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_job_report_section_snapshots_report
ON job_report_section_snapshots(job_report_snapshot_id, sequence);

CREATE OR REPLACE VIEW job_detail_view AS
SELECT
    wo.id AS work_order_id,
    wo.job_number,
    wo.name AS job_name,
    wo.project_id,
    p.name AS project_name,
    wo.account_id,
    acct.account_name,
    wo.job_site_id,
    js.name AS job_site_name,
    wo.job_type_version_id,
    jt.type_code AS job_type_code,
    jt.name AS job_type_name,
    jtv.version_number AS job_type_version_number,
    wo.status,
    wo.dispatch_status,
    wo.office_review_status,
    wo.priority,
    wo.requested_service_at,
    schedule_window.planned_start,
    schedule_window.planned_end,
    wo.actual_started_at,
    wo.actual_completed_at,
    wo.field_lead_employee_id,
    field_lead.display_name AS field_lead_name,
    primary_location.address_line_one,
    primary_location.city,
    primary_location.state_or_province,
    primary_location.postal_code,
    primary_location.latitude,
    primary_location.longitude,
    progress.total_steps,
    progress.completed_steps,
    progress.total_actions,
    progress.completed_actions,
    progress.blocked_actions,
    progress.completion_percent,
    dispatch.worker_count,
    dispatch.resource_count,
    dispatch.blocking_conflict_count,
    exception_totals.open_exception_count,
    exception_totals.blocking_exception_count,
    wo.customer_po_number,
    wo.bioremedy_po_number,
    wo.generator_responsible_party,
    wo.onsite_contact_name,
    wo.onsite_contact_phone,
    wo.job_description,
    wo.updated_at
FROM work_orders wo
LEFT JOIN projects p ON p.id = wo.project_id
LEFT JOIN accounts acct ON acct.id = wo.account_id
LEFT JOIN job_sites js ON js.id = wo.job_site_id
LEFT JOIN job_type_versions jtv ON jtv.id = wo.job_type_version_id
LEFT JOIN job_types jt ON jt.id = jtv.job_type_id
LEFT JOIN employees field_lead ON field_lead.id = wo.field_lead_employee_id
LEFT JOIN job_execution_progress_view progress ON progress.work_order_id = wo.id
LEFT JOIN dispatch_board_view dispatch ON dispatch.work_order_id = wo.id
LEFT JOIN LATERAL (
    SELECT
        jl.address_line_one,
        jl.city,
        jl.state_or_province,
        jl.postal_code,
        jl.latitude,
        jl.longitude
    FROM job_locations jl
    WHERE jl.work_order_id = wo.id
      AND jl.deleted_at IS NULL
    ORDER BY jl.is_primary DESC, jl.created_at
    LIMIT 1
) primary_location ON true
LEFT JOIN LATERAL (
    SELECT
        MIN(jss.planned_start) AS planned_start,
        MAX(jss.planned_end) AS planned_end
    FROM job_schedule_segments jss
    WHERE jss.work_order_id = wo.id
      AND jss.deleted_at IS NULL
      AND jss.status <> 'cancelled'
) schedule_window ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE je.status = 'open') AS open_exception_count,
        COUNT(*) FILTER (
            WHERE je.status = 'open' AND je.severity IN ('blocking', 'critical')
        ) AS blocking_exception_count
    FROM job_exceptions je
    WHERE je.work_order_id = wo.id AND je.deleted_at IS NULL
) exception_totals ON true
WHERE wo.deleted_at IS NULL;

CREATE OR REPLACE VIEW job_dispatch_readiness_view AS
SELECT
    jd.work_order_id,
    jd.job_number,
    jd.job_name,
    jd.project_name,
    jd.account_name,
    jd.job_type_code,
    jd.status,
    jd.dispatch_status,
    jd.priority,
    jd.planned_start,
    jd.planned_end,
    jd.worker_count,
    jd.resource_count,
    jd.blocking_conflict_count,
    CASE
        WHEN jd.job_type_version_id IS NULL THEN 'blocked'
        WHEN jd.planned_start IS NULL OR jd.planned_end IS NULL THEN 'blocked'
        WHEN coalesce(jd.worker_count, 0) = 0 THEN 'blocked'
        WHEN coalesce(jd.blocking_conflict_count, 0) > 0 THEN 'blocked'
        WHEN coalesce(jd.resource_count, 0) = 0 THEN 'warning'
        ELSE 'ready'
    END AS readiness_status,
    ARRAY_REMOVE(ARRAY[
        CASE WHEN jd.job_type_version_id IS NULL THEN 'Missing job type version' END,
        CASE WHEN jd.planned_start IS NULL OR jd.planned_end IS NULL THEN 'Missing schedule' END,
        CASE WHEN coalesce(jd.worker_count, 0) = 0 THEN 'No workers assigned' END,
        CASE
            WHEN coalesce(jd.blocking_conflict_count, 0) > 0
            THEN jd.blocking_conflict_count || ' blocking conflict(s)'
        END,
        CASE
            WHEN coalesce(jd.resource_count, 0) = 0
            THEN 'No resources allocated'
        END
    ], NULL) AS readiness_reasons,
    jd.updated_at
FROM job_detail_view jd;

CREATE OR REPLACE VIEW frontline_assignment_view AS
SELECT
    ja.id AS job_assignment_id,
    ja.employee_id,
    e.employee_number,
    e.display_name AS employee_name,
    wo.id AS work_order_id,
    wo.job_number,
    wo.name AS job_name,
    wo.status AS job_status,
    ja.assignment_status,
    ja.assignment_role,
    ja.is_field_lead,
    coalesce(ja.planned_start, schedule_window.planned_start) AS planned_start,
    coalesce(ja.planned_end, schedule_window.planned_end) AS planned_end,
    wo.schedule_timezone,
    acct.account_name,
    primary_location.name_snapshot AS location_name,
    primary_location.address_line_one,
    primary_location.city,
    primary_location.state_or_province,
    primary_location.postal_code,
    primary_location.latitude,
    primary_location.longitude,
    latest_package.id AS frontline_job_package_id,
    latest_package.package_version,
    latest_package.package_status,
    recipient.delivery_status,
    wo.job_package_version,
    wo.updated_at
FROM job_assignments ja
JOIN employees e ON e.id = ja.employee_id
JOIN work_orders wo ON wo.id = ja.work_order_id
LEFT JOIN accounts acct ON acct.id = wo.account_id
LEFT JOIN LATERAL (
    SELECT
        MIN(jss.planned_start) AS planned_start,
        MAX(jss.planned_end) AS planned_end
    FROM job_schedule_segments jss
    WHERE jss.work_order_id = wo.id
      AND jss.deleted_at IS NULL
      AND jss.status <> 'cancelled'
) schedule_window ON true
LEFT JOIN LATERAL (
    SELECT jl.*
    FROM job_locations jl
    WHERE jl.work_order_id = wo.id AND jl.deleted_at IS NULL
    ORDER BY jl.is_primary DESC, jl.created_at
    LIMIT 1
) primary_location ON true
LEFT JOIN LATERAL (
    SELECT fjp.*
    FROM frontline_job_packages fjp
    WHERE fjp.work_order_id = wo.id
      AND fjp.package_status IN ('ready', 'building')
    ORDER BY fjp.package_version DESC
    LIMIT 1
) latest_package ON true
LEFT JOIN frontline_job_package_recipients recipient
    ON recipient.frontline_job_package_id = latest_package.id
    AND recipient.employee_id = ja.employee_id
WHERE ja.employee_id IS NOT NULL
  AND ja.deleted_at IS NULL
  AND wo.deleted_at IS NULL
  AND ja.assignment_status NOT IN ('released', 'cancelled');

CREATE OR REPLACE VIEW job_billing_summary_view AS
SELECT
    wo.id AS work_order_id,
    wo.job_number,
    wo.name AS job_name,
    wo.account_id,
    acct.account_name,
    wo.quote_id,
    wo.sales_order_id,
    cost_totals.pending_cost,
    cost_totals.approved_cost,
    charge_totals.candidate_amount,
    charge_totals.approved_amount,
    charge_totals.invoiced_amount,
    CASE
        WHEN coalesce(charge_totals.approved_amount, 0) = 0 THEN NULL
        ELSE round(
            100.0 * (
                charge_totals.approved_amount - coalesce(cost_totals.approved_cost, 0)
            ) / charge_totals.approved_amount,
            2
        )
    END AS approved_margin_percent,
    billing_review.review_status,
    billing_review.assigned_to_user_id,
    wo.updated_at
FROM work_orders wo
LEFT JOIN accounts acct ON acct.id = wo.account_id
LEFT JOIN LATERAL (
    SELECT
        coalesce(SUM(jce.extended_cost) FILTER (WHERE jce.status = 'pending'), 0) AS pending_cost,
        coalesce(SUM(jce.extended_cost) FILTER (WHERE jce.status = 'approved'), 0) AS approved_cost
    FROM job_cost_entries jce
    WHERE jce.work_order_id = wo.id AND jce.deleted_at IS NULL
) cost_totals ON true
LEFT JOIN LATERAL (
    SELECT
        coalesce(SUM(jch.extended_amount + jch.tax_amount) FILTER (
            WHERE jch.billing_status IN ('candidate', 'review')
        ), 0) AS candidate_amount,
        coalesce(SUM(jch.extended_amount + jch.tax_amount) FILTER (
            WHERE jch.billing_status = 'approved'
        ), 0) AS approved_amount,
        coalesce(SUM(jch.extended_amount + jch.tax_amount) FILTER (
            WHERE jch.billing_status = 'invoiced'
        ), 0) AS invoiced_amount
    FROM job_charge_entries jch
    WHERE jch.work_order_id = wo.id
      AND jch.deleted_at IS NULL
      AND jch.billable = true
) charge_totals ON true
LEFT JOIN LATERAL (
    SELECT jbr.review_status, jbr.assigned_to_user_id
    FROM job_billing_reviews jbr
    WHERE jbr.work_order_id = wo.id AND jbr.deleted_at IS NULL
    ORDER BY jbr.created_at DESC
    LIMIT 1
) billing_review ON true
WHERE wo.deleted_at IS NULL;

CREATE OR REPLACE VIEW job_report_timeline_view AS
SELECT
    jee.work_order_id,
    jee.event_sequence,
    jee.id AS source_id,
    'execution_event'::text AS source_type,
    jee.event_type,
    jee.event_name AS title,
    jee.client_captured_at AS captured_at,
    jee.server_received_at AS received_at,
    e.display_name AS actor_name,
    jee.job_action_instance_id,
    jee.payload AS detail
FROM job_execution_events jee
LEFT JOIN employees e ON e.id = jee.actor_employee_id

UNION ALL

SELECT
    fs.work_order_id,
    NULL::bigint AS event_sequence,
    fs.id AS source_id,
    'form_submission'::text AS source_type,
    fs.status AS event_type,
    ft.name AS title,
    fs.captured_at,
    fs.received_at,
    coalesce(e.display_name, su.full_name) AS actor_name,
    fs.job_action_instance_id,
    jsonb_build_object(
        'form_version_id', fs.form_version_id,
        'submission_number', fs.submission_number,
        'revision_number', fs.revision_number,
        'status', fs.status
    ) AS detail
FROM form_submissions fs
JOIN form_versions fv ON fv.id = fs.form_version_id
JOIN form_templates ft ON ft.id = fv.form_template_id
LEFT JOIN employees e ON e.id = fs.submitted_by_employee_id
LEFT JOIN system_users su ON su.id = fs.submitted_by_user_id
WHERE fs.deleted_at IS NULL

UNION ALL

SELECT
    jm.work_order_id,
    NULL::bigint AS event_sequence,
    jm.id AS source_id,
    'media'::text AS source_type,
    jm.media_type AS event_type,
    coalesce(jm.caption, initcap(jm.media_type)) AS title,
    jm.captured_at,
    jm.created_at AS received_at,
    e.display_name AS actor_name,
    jm.job_action_instance_id,
    jsonb_build_object(
        'file_id', jm.file_id,
        'latitude', jm.latitude,
        'longitude', jm.longitude,
        'report_section_key', jm.report_section_key
    ) AS detail
FROM job_media jm
LEFT JOIN employees e ON e.id = jm.captured_by_employee_id
WHERE jm.deleted_at IS NULL

UNION ALL

SELECT
    ps.work_order_id,
    NULL::bigint AS event_sequence,
    ps.id AS source_id,
    'sample'::text AS source_type,
    ps.status AS event_type,
    ps.sample_identifier AS title,
    coalesce(ps.collected_at, ps.sample_date::timestamp) AS captured_at,
    ps.created_at AS received_at,
    coalesce(ps.collected_by_name, e.display_name) AS actor_name,
    ps.job_action_instance_id,
    jsonb_build_object(
        'sample_type', ps.sample_type,
        'sample_matrix', ps.sample_matrix,
        'chain_of_custody_number', ps.chain_of_custody_number,
        'result_summary', ps.result_summary
    ) AS detail
FROM project_samples ps
LEFT JOIN employees e ON e.system_user_id = ps.collected_by_user_id
WHERE ps.work_order_id IS NOT NULL AND ps.deleted_at IS NULL;
