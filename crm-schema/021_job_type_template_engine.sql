CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Versioned job plan definitions.
-- A job type version owns an ordered plan of steps and actions. Actions may
-- collect one or more forms and map their outputs into operational records.

CREATE TABLE IF NOT EXISTS job_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    project_class TEXT,
    owning_business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_job_types_category
ON job_types(category);

CREATE TABLE IF NOT EXISTS job_type_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type_id UUID NOT NULL REFERENCES job_types(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    version_label TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'in_review', 'published', 'retired')
    ),
    default_priority TEXT NOT NULL DEFAULT 'normal',
    default_duration_minutes INTEGER CHECK (
        default_duration_minutes IS NULL OR default_duration_minutes > 0
    ),
    default_crew_size INTEGER CHECK (default_crew_size IS NULL OR default_crew_size > 0),
    allow_multi_day BOOLEAN NOT NULL DEFAULT false,
    customer_signature_required BOOLEAN NOT NULL DEFAULT false,
    office_review_required BOOLEAN NOT NULL DEFAULT true,
    dispatch_instructions TEXT,
    field_instructions TEXT,
    report_template_key TEXT,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    schema_hash TEXT,
    change_summary TEXT,
    published_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    published_at TIMESTAMP,
    retired_at TIMESTAMP,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_type_id, version_number),
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_job_type_versions_type_status
ON job_type_versions(job_type_id, status);

CREATE TABLE IF NOT EXISTS job_step_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type_version_id UUID NOT NULL REFERENCES job_type_versions(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    execution_mode TEXT NOT NULL DEFAULT 'sequential' CHECK (
        execution_mode IN ('sequential', 'parallel', 'conditional')
    ),
    required BOOLEAN NOT NULL DEFAULT true,
    completion_rule TEXT NOT NULL DEFAULT 'all_required_actions' CHECK (
        completion_rule IN ('all_required_actions', 'any_action', 'manual', 'expression')
    ),
    completion_expression JSONB,
    allow_reopen BOOLEAN NOT NULL DEFAULT false,
    report_section_key TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_type_version_id, step_key),
    UNIQUE (job_type_version_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_job_step_definitions_version
ON job_step_definitions(job_type_version_id, sequence);

CREATE TABLE IF NOT EXISTS job_action_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_step_definition_id UUID NOT NULL REFERENCES job_step_definitions(id) ON DELETE CASCADE,
    action_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    action_type TEXT NOT NULL CHECK (
        action_type IN (
            'instruction',
            'checklist',
            'form',
            'timer',
            'photo',
            'signature',
            'sample',
            'material',
            'equipment',
            'waste',
            'travel',
            'approval',
            'notification',
            'status_transition'
        )
    ),
    assignee_scope TEXT NOT NULL DEFAULT 'any_assigned_worker' CHECK (
        assignee_scope IN (
            'any_assigned_worker',
            'all_assigned_workers',
            'field_lead',
            'specific_role',
            'dispatcher',
            'office_reviewer'
        )
    ),
    assignee_role TEXT,
    required BOOLEAN NOT NULL DEFAULT true,
    allow_skip BOOLEAN NOT NULL DEFAULT false,
    skip_requires_reason BOOLEAN NOT NULL DEFAULT true,
    allow_repeat BOOLEAN NOT NULL DEFAULT false,
    minimum_completions INTEGER NOT NULL DEFAULT 1 CHECK (minimum_completions >= 0),
    maximum_completions INTEGER CHECK (
        maximum_completions IS NULL OR maximum_completions >= minimum_completions
    ),
    completion_rule TEXT NOT NULL DEFAULT 'manual' CHECK (
        completion_rule IN (
            'manual',
            'form_completed',
            'timer_stopped',
            'record_created',
            'approval_received',
            'expression'
        )
    ),
    completion_expression JSONB,
    start_status_transition TEXT,
    completion_status_transition TEXT,
    expected_duration_minutes INTEGER CHECK (
        expected_duration_minutes IS NULL OR expected_duration_minutes >= 0
    ),
    capture_gps BOOLEAN NOT NULL DEFAULT false,
    capture_timestamp BOOLEAN NOT NULL DEFAULT true,
    offline_available BOOLEAN NOT NULL DEFAULT true,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_step_definition_id, action_key),
    UNIQUE (job_step_definition_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_job_action_definitions_step
ON job_action_definitions(job_step_definition_id, sequence);

CREATE INDEX IF NOT EXISTS idx_job_action_definitions_type
ON job_action_definitions(action_type);

CREATE TABLE IF NOT EXISTS job_action_definition_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_definition_id UUID NOT NULL REFERENCES job_action_definitions(id) ON DELETE CASCADE,
    depends_on_action_definition_id UUID NOT NULL REFERENCES job_action_definitions(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'completed' CHECK (
        dependency_type IN ('started', 'completed', 'approved', 'skipped', 'expression')
    ),
    condition_expression JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (action_definition_id, depends_on_action_definition_id),
    CHECK (action_definition_id <> depends_on_action_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_job_action_definition_dependencies_target
ON job_action_definition_dependencies(depends_on_action_definition_id);

CREATE TABLE IF NOT EXISTS job_action_form_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_action_definition_id UUID NOT NULL REFERENCES job_action_definitions(id) ON DELETE CASCADE,
    form_version_id UUID NOT NULL REFERENCES form_versions(id),
    purpose TEXT NOT NULL DEFAULT 'primary' CHECK (
        purpose IN ('primary', 'supporting', 'exception', 'approval', 'closeout')
    ),
    sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
    required BOOLEAN NOT NULL DEFAULT true,
    minimum_submissions INTEGER NOT NULL DEFAULT 1 CHECK (minimum_submissions >= 0),
    maximum_submissions INTEGER CHECK (
        maximum_submissions IS NULL OR maximum_submissions >= minimum_submissions
    ),
    prefill_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_action_definition_id, purpose, sequence)
);

CREATE INDEX IF NOT EXISTS idx_job_action_form_links_action
ON job_action_form_links(job_action_definition_id, sequence);

CREATE INDEX IF NOT EXISTS idx_job_action_form_links_form
ON job_action_form_links(form_version_id);

CREATE TABLE IF NOT EXISTS job_type_required_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type_version_id UUID NOT NULL REFERENCES job_type_versions(id) ON DELETE CASCADE,
    certification_type_id UUID NOT NULL REFERENCES certification_types(id),
    minimum_worker_count INTEGER NOT NULL DEFAULT 1 CHECK (minimum_worker_count > 0),
    required_for_role TEXT,
    must_remain_valid_through_job BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_type_version_id, certification_type_id, required_for_role)
);

CREATE TABLE IF NOT EXISTS job_type_required_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type_version_id UUID NOT NULL REFERENCES job_type_versions(id) ON DELETE CASCADE,
    credential_type_id UUID NOT NULL REFERENCES credential_types(id),
    minimum_worker_count INTEGER NOT NULL DEFAULT 1 CHECK (minimum_worker_count > 0),
    required_for_role TEXT,
    must_remain_valid_through_job BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_type_version_id, credential_type_id, required_for_role)
);

CREATE TABLE IF NOT EXISTS job_type_required_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type_version_id UUID NOT NULL REFERENCES job_type_versions(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id),
    minimum_proficiency_level INTEGER NOT NULL DEFAULT 1 CHECK (
        minimum_proficiency_level BETWEEN 1 AND 5
    ),
    minimum_worker_count INTEGER NOT NULL DEFAULT 1 CHECK (minimum_worker_count > 0),
    required_for_role TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (job_type_version_id, skill_id, required_for_role)
);

CREATE TABLE IF NOT EXISTS job_type_required_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type_version_id UUID NOT NULL REFERENCES job_type_versions(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL CHECK (
        resource_type IN ('equipment_type', 'equipment', 'vehicle', 'product', 'vendor')
    ),
    equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    resource_code TEXT,
    description TEXT,
    quantity NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    required BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (
        equipment_id IS NOT NULL OR
        product_id IS NOT NULL OR
        resource_code IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_job_type_required_resources_version
ON job_type_required_resources(job_type_version_id, resource_type);

CREATE TABLE IF NOT EXISTS job_type_publication_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type_version_id UUID NOT NULL REFERENCES job_type_versions(id) ON DELETE CASCADE,
    check_code TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'information')),
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'waived')),
    message TEXT,
    checked_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    checked_at TIMESTAMP NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (job_type_version_id, check_code)
);

CREATE OR REPLACE VIEW published_job_type_catalog_view AS
SELECT
    jt.id AS job_type_id,
    jt.type_code,
    jt.name,
    jt.category,
    jt.project_class,
    jtv.id AS job_type_version_id,
    jtv.version_number,
    jtv.version_label,
    jtv.default_priority,
    jtv.default_duration_minutes,
    jtv.default_crew_size,
    jtv.allow_multi_day,
    jtv.customer_signature_required,
    jtv.office_review_required,
    COUNT(DISTINCT jsd.id) FILTER (WHERE jsd.deleted_at IS NULL) AS step_count,
    COUNT(DISTINCT jad.id) FILTER (WHERE jad.deleted_at IS NULL) AS action_count,
    COUNT(DISTINCT jafl.id) FILTER (WHERE jafl.deleted_at IS NULL) AS linked_form_count,
    jtv.published_at
FROM job_types jt
JOIN job_type_versions jtv
    ON jtv.job_type_id = jt.id
    AND jtv.status = 'published'
    AND jtv.deleted_at IS NULL
LEFT JOIN job_step_definitions jsd ON jsd.job_type_version_id = jtv.id
LEFT JOIN job_action_definitions jad ON jad.job_step_definition_id = jsd.id
LEFT JOIN job_action_form_links jafl ON jafl.job_action_definition_id = jad.id
WHERE jt.deleted_at IS NULL
GROUP BY jt.id, jtv.id;
