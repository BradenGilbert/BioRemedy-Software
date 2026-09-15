CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Operational workforce identity.
-- system_users remains the sign-in/authorization record. employees is the
-- operational worker record and may exist before a Front Line login is issued.

CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_number TEXT NOT NULL UNIQUE,
    system_user_id UUID UNIQUE REFERENCES system_users(id) ON DELETE SET NULL,
    business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    preferred_name TEXT,
    display_name TEXT NOT NULL,
    job_title TEXT,
    primary_email TEXT,
    mobile_phone TEXT,
    employment_status TEXT NOT NULL DEFAULT 'active' CHECK (
        employment_status IN ('candidate', 'active', 'leave', 'inactive', 'terminated')
    ),
    employment_type TEXT CHECK (
        employment_type IS NULL OR employment_type IN (
            'full_time',
            'part_time',
            'temporary',
            'contractor',
            'seasonal'
        )
    ),
    hire_date DATE,
    termination_date DATE,
    default_timezone TEXT NOT NULL DEFAULT 'America/Chicago',
    dispatch_eligible BOOLEAN NOT NULL DEFAULT true,
    frontline_enabled BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (termination_date IS NULL OR hire_date IS NULL OR termination_date >= hire_date)
);

CREATE INDEX IF NOT EXISTS idx_employees_system_user
ON employees(system_user_id);

CREATE INDEX IF NOT EXISTS idx_employees_business_unit
ON employees(business_unit_id);

CREATE INDEX IF NOT EXISTS idx_employees_manager
ON employees(manager_employee_id);

CREATE INDEX IF NOT EXISTS idx_employees_status
ON employees(employment_status);

CREATE INDEX IF NOT EXISTS idx_employees_dispatch_eligible
ON employees(dispatch_eligible)
WHERE deleted_at IS NULL AND employment_status = 'active';

CREATE INDEX IF NOT EXISTS idx_employees_search
ON employees
USING GIN (
    to_tsvector(
        'english',
        coalesce(employee_number, '') || ' ' ||
        coalesce(display_name, '') || ' ' ||
        coalesce(job_title, '') || ' ' ||
        coalesce(primary_email, '')
    )
);

CREATE TABLE IF NOT EXISTS employment_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    position_code TEXT,
    position_title TEXT NOT NULL,
    department_name TEXT,
    role_code TEXT,
    assignment_status TEXT NOT NULL DEFAULT 'active' CHECK (
        assignment_status IN ('planned', 'active', 'inactive', 'ended')
    ),
    effective_start DATE NOT NULL,
    effective_end DATE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);

CREATE INDEX IF NOT EXISTS idx_employment_assignments_employee
ON employment_assignments(employee_id, effective_start, effective_end);

CREATE INDEX IF NOT EXISTS idx_employment_assignments_manager
ON employment_assignments(manager_employee_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employment_assignments_primary_active
ON employment_assignments(employee_id)
WHERE is_primary = true AND assignment_status = 'active' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS credential_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (
        category IN ('license', 'identity', 'permit', 'clearance', 'medical_clearance', 'other')
    ),
    issuing_authority TEXT,
    expiration_required BOOLEAN NOT NULL DEFAULT false,
    verification_required BOOLEAN NOT NULL DEFAULT true,
    number_required BOOLEAN NOT NULL DEFAULT false,
    renewal_lead_days INTEGER NOT NULL DEFAULT 30 CHECK (renewal_lead_days >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS employee_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    credential_type_id UUID NOT NULL REFERENCES credential_types(id),
    credential_number TEXT,
    issuing_authority TEXT,
    issued_on DATE,
    expires_on DATE,
    status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (
        status IN ('pending_verification', 'valid', 'expiring', 'expired', 'suspended', 'revoked')
    ),
    verified_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP,
    evidence_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

CREATE INDEX IF NOT EXISTS idx_employee_credentials_employee
ON employee_credentials(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_credentials_type
ON employee_credentials(credential_type_id);

CREATE INDEX IF NOT EXISTS idx_employee_credentials_expiration
ON employee_credentials(expires_on)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_credentials_status
ON employee_credentials(status);

CREATE TABLE IF NOT EXISTS certification_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'training',
    issuing_authority TEXT,
    description TEXT,
    validity_months INTEGER CHECK (validity_months IS NULL OR validity_months > 0),
    renewal_lead_days INTEGER NOT NULL DEFAULT 30 CHECK (renewal_lead_days >= 0),
    verification_required BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS employee_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    certification_type_id UUID NOT NULL REFERENCES certification_types(id),
    certificate_number TEXT,
    issued_on DATE,
    expires_on DATE,
    status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (
        status IN ('planned', 'pending_verification', 'valid', 'expiring', 'expired', 'suspended', 'revoked')
    ),
    verified_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP,
    evidence_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    training_provider TEXT,
    score TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

CREATE INDEX IF NOT EXISTS idx_employee_certifications_employee
ON employee_certifications(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_certifications_type
ON employee_certifications(certification_type_id);

CREATE INDEX IF NOT EXISTS idx_employee_certifications_expiration
ON employee_certifications(expires_on)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_certifications_status
ON employee_certifications(status);

CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS employee_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id),
    proficiency_level INTEGER NOT NULL DEFAULT 1 CHECK (proficiency_level BETWEEN 1 AND 5),
    verified_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP,
    last_used_on DATE,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (employee_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_skills_employee
ON employee_skills(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_skills_skill
ON employee_skills(skill_id, proficiency_level);

CREATE TABLE IF NOT EXISTS equipment_qualification_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    equipment_type TEXT NOT NULL,
    description TEXT,
    certification_type_id UUID REFERENCES certification_types(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS employee_equipment_qualifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    qualification_type_id UUID NOT NULL REFERENCES equipment_qualification_types(id),
    status TEXT NOT NULL DEFAULT 'valid' CHECK (
        status IN ('planned', 'valid', 'expired', 'suspended', 'revoked')
    ),
    qualified_on DATE,
    expires_on DATE,
    verified_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (employee_id, qualification_type_id),
    CHECK (expires_on IS NULL OR qualified_on IS NULL OR expires_on >= qualified_on)
);

CREATE INDEX IF NOT EXISTS idx_employee_equipment_qualifications_employee
ON employee_equipment_qualifications(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_equipment_qualifications_expiration
ON employee_equipment_qualifications(expires_on)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    title TEXT NOT NULL,
    visibility_scope TEXT NOT NULL DEFAULT 'workforce_manager' CHECK (
        visibility_scope IN ('employee', 'dispatcher', 'workforce_manager', 'administrator')
    ),
    effective_on DATE,
    expires_on DATE,
    verified_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (employee_id, file_id, document_type),
    CHECK (expires_on IS NULL OR effective_on IS NULL OR expires_on >= effective_on)
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee
ON employee_documents(employee_id, document_type);

CREATE INDEX IF NOT EXISTS idx_employee_documents_expiration
ON employee_documents(expires_on)
WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW employee_credential_status_view AS
SELECT
    e.id AS employee_id,
    e.employee_number,
    e.display_name,
    e.employment_status,
    e.dispatch_eligible,
    ec.id AS record_id,
    'credential'::text AS record_type,
    ct.code AS requirement_code,
    ct.name AS requirement_name,
    ec.status,
    ec.issued_on,
    ec.expires_on,
    ct.renewal_lead_days,
    CASE
        WHEN ec.status IN ('suspended', 'revoked') THEN 'blocked'
        WHEN ec.expires_on IS NOT NULL AND ec.expires_on < CURRENT_DATE THEN 'expired'
        WHEN ec.expires_on IS NOT NULL
            AND ec.expires_on <= CURRENT_DATE + ct.renewal_lead_days THEN 'expiring'
        WHEN ec.status = 'valid' THEN 'ready'
        ELSE 'review'
    END AS readiness
FROM employees e
JOIN employee_credentials ec ON ec.employee_id = e.id AND ec.deleted_at IS NULL
JOIN credential_types ct ON ct.id = ec.credential_type_id AND ct.deleted_at IS NULL
WHERE e.deleted_at IS NULL

UNION ALL

SELECT
    e.id AS employee_id,
    e.employee_number,
    e.display_name,
    e.employment_status,
    e.dispatch_eligible,
    cert.id AS record_id,
    'certification'::text AS record_type,
    ctype.code AS requirement_code,
    ctype.name AS requirement_name,
    cert.status,
    cert.issued_on,
    cert.expires_on,
    ctype.renewal_lead_days,
    CASE
        WHEN cert.status IN ('suspended', 'revoked') THEN 'blocked'
        WHEN cert.expires_on IS NOT NULL AND cert.expires_on < CURRENT_DATE THEN 'expired'
        WHEN cert.expires_on IS NOT NULL
            AND cert.expires_on <= CURRENT_DATE + ctype.renewal_lead_days THEN 'expiring'
        WHEN cert.status = 'valid' THEN 'ready'
        ELSE 'review'
    END AS readiness
FROM employees e
JOIN employee_certifications cert ON cert.employee_id = e.id AND cert.deleted_at IS NULL
JOIN certification_types ctype ON ctype.id = cert.certification_type_id AND ctype.deleted_at IS NULL
WHERE e.deleted_at IS NULL;
