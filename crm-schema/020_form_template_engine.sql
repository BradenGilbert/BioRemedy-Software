CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Versioned form definitions.
-- Published versions are treated as immutable application contracts. Jobs and
-- submissions always reference a specific version, never the mutable template.

CREATE TABLE IF NOT EXISTS form_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    owning_business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_form_templates_category
ON form_templates(category);

CREATE INDEX IF NOT EXISTS idx_form_templates_business_unit
ON form_templates(owning_business_unit_id);

CREATE TABLE IF NOT EXISTS form_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    version_label TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'in_review', 'published', 'retired')
    ),
    instructions TEXT,
    completion_message TEXT,
    allow_partial_save BOOLEAN NOT NULL DEFAULT true,
    signature_required BOOLEAN NOT NULL DEFAULT false,
    gps_capture_mode TEXT NOT NULL DEFAULT 'optional' CHECK (
        gps_capture_mode IN ('none', 'optional', 'required')
    ),
    schema_hash TEXT,
    change_summary TEXT,
    published_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    published_at TIMESTAMP,
    retired_at TIMESTAMP,
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (form_template_id, version_number),
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_form_versions_template_status
ON form_versions(form_template_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_versions_published_schema_hash
ON form_versions(schema_hash)
WHERE schema_hash IS NOT NULL AND status = 'published' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS form_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
    section_key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    repeatable BOOLEAN NOT NULL DEFAULT false,
    minimum_repetitions INTEGER NOT NULL DEFAULT 0 CHECK (minimum_repetitions >= 0),
    maximum_repetitions INTEGER CHECK (
        maximum_repetitions IS NULL OR maximum_repetitions >= minimum_repetitions
    ),
    display_style TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (form_version_id, section_key),
    UNIQUE (form_version_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_form_sections_version
ON form_sections(form_version_id, sequence);

CREATE TABLE IF NOT EXISTS form_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
    form_section_id UUID REFERENCES form_sections(id) ON DELETE CASCADE,
    field_key TEXT NOT NULL,
    label TEXT NOT NULL,
    help_text TEXT,
    field_type TEXT NOT NULL CHECK (
        field_type IN (
            'short_text',
            'long_text',
            'integer',
            'decimal',
            'currency',
            'boolean',
            'date',
            'time',
            'datetime',
            'single_select',
            'multi_select',
            'signature',
            'photo',
            'file',
            'barcode',
            'gps',
            'employee',
            'equipment',
            'product',
            'account',
            'contact',
            'sample',
            'waste_container',
            'calculated',
            'instruction'
        )
    ),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    required BOOLEAN NOT NULL DEFAULT false,
    read_only BOOLEAN NOT NULL DEFAULT false,
    default_value JSONB,
    placeholder TEXT,
    unit_label TEXT,
    minimum_numeric NUMERIC(18,6),
    maximum_numeric NUMERIC(18,6),
    minimum_length INTEGER CHECK (minimum_length IS NULL OR minimum_length >= 0),
    maximum_length INTEGER CHECK (
        maximum_length IS NULL OR maximum_length >= coalesce(minimum_length, 0)
    ),
    validation_pattern TEXT,
    calculation_expression TEXT,
    reference_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    capture_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    report_visibility TEXT NOT NULL DEFAULT 'always' CHECK (
        report_visibility IN ('always', 'when_answered', 'never')
    ),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (form_version_id, field_key),
    UNIQUE (form_section_id, sequence),
    CHECK (maximum_numeric IS NULL OR minimum_numeric IS NULL OR maximum_numeric >= minimum_numeric)
);

CREATE INDEX IF NOT EXISTS idx_form_fields_version
ON form_fields(form_version_id, sequence);

CREATE INDEX IF NOT EXISTS idx_form_fields_section
ON form_fields(form_section_id, sequence);

CREATE TABLE IF NOT EXISTS form_field_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_field_id UUID NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
    option_value TEXT NOT NULL,
    option_label TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (form_field_id, option_value),
    UNIQUE (form_field_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_form_field_options_field
ON form_field_options(form_field_id, sequence);

CREATE TABLE IF NOT EXISTS form_field_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
    source_field_id UUID NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
    target_field_id UUID REFERENCES form_fields(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (
        rule_type IN (
            'visibility',
            'required',
            'validation',
            'set_value',
            'clear_value',
            'calculation',
            'warning'
        )
    ),
    operator TEXT NOT NULL,
    comparison_value JSONB,
    expression JSONB,
    message TEXT,
    sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_form_field_rules_version
ON form_field_rules(form_version_id, sequence);

CREATE INDEX IF NOT EXISTS idx_form_field_rules_source
ON form_field_rules(source_field_id);

CREATE TABLE IF NOT EXISTS form_output_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
    mapping_key TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    trigger_when TEXT NOT NULL DEFAULT 'submission_completed' CHECK (
        trigger_when IN ('field_changed', 'submission_saved', 'submission_completed', 'submission_approved')
    ),
    operation TEXT NOT NULL CHECK (
        operation IN (
            'create_record',
            'update_record',
            'emit_event',
            'set_job_field',
            'raise_exception',
            'create_follow_up_job',
            'create_office_task'
        )
    ),
    target_entity TEXT NOT NULL,
    source_field_key TEXT,
    target_field_name TEXT,
    value_expression JSONB,
    condition_expression JSONB,
    idempotency_scope TEXT NOT NULL DEFAULT 'submission' CHECK (
        idempotency_scope IN ('submission', 'action', 'job', 'none')
    ),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (form_version_id, mapping_key),
    UNIQUE (form_version_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_form_output_mappings_target
ON form_output_mappings(target_entity, operation);

CREATE TABLE IF NOT EXISTS form_version_publication_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_version_id UUID NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
    check_code TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'information')),
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'waived')),
    message TEXT,
    checked_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    checked_at TIMESTAMP NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (form_version_id, check_code)
);

CREATE INDEX IF NOT EXISTS idx_form_version_publication_checks_status
ON form_version_publication_checks(form_version_id, status, severity);

CREATE OR REPLACE VIEW published_form_catalog_view AS
SELECT
    ft.id AS form_template_id,
    ft.template_code,
    ft.name,
    ft.category,
    fv.id AS form_version_id,
    fv.version_number,
    fv.version_label,
    fv.schema_hash,
    fv.signature_required,
    fv.gps_capture_mode,
    COUNT(DISTINCT fs.id) FILTER (WHERE fs.deleted_at IS NULL) AS section_count,
    COUNT(DISTINCT ff.id) FILTER (WHERE ff.deleted_at IS NULL) AS field_count,
    COUNT(DISTINCT fom.id) FILTER (WHERE fom.deleted_at IS NULL) AS output_mapping_count,
    fv.published_at
FROM form_templates ft
JOIN form_versions fv
    ON fv.form_template_id = ft.id
    AND fv.status = 'published'
    AND fv.deleted_at IS NULL
LEFT JOIN form_sections fs ON fs.form_version_id = fv.id
LEFT JOIN form_fields ff ON ff.form_version_id = fv.id
LEFT JOIN form_output_mappings fom ON fom.form_version_id = fv.id
WHERE ft.deleted_at IS NULL
GROUP BY ft.id, fv.id;
