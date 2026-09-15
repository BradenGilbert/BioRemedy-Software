CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Durable organization and field scheduling availability.
-- Teams describe reporting structure; crews describe dispatchable field groups.

ALTER TABLE teams
ADD COLUMN IF NOT EXISTS team_code TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_team_code
ON teams(team_code)
WHERE team_code IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teams_manager_employee
ON teams(manager_employee_id);

CREATE TABLE IF NOT EXISTS team_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    membership_role TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    effective_start DATE NOT NULL,
    effective_end DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('planned', 'active', 'inactive', 'ended')
    ),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);

CREATE INDEX IF NOT EXISTS idx_team_memberships_team
ON team_memberships(team_id, effective_start, effective_end);

CREATE INDEX IF NOT EXISTS idx_team_memberships_employee
ON team_memberships(employee_id, effective_start, effective_end);

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_memberships_primary_active
ON team_memberships(employee_id)
WHERE is_primary = true AND status = 'active' AND deleted_at IS NULL;

ALTER TABLE crews
ADD COLUMN IF NOT EXISTS crew_code TEXT,
ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS crew_type TEXT,
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS supervisor_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS default_start_location TEXT,
ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Chicago';

CREATE UNIQUE INDEX IF NOT EXISTS uq_crews_crew_code
ON crews(crew_code)
WHERE crew_code IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crews_supervisor
ON crews(supervisor_employee_id);

ALTER TABLE crew_members
ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS effective_start DATE,
ADD COLUMN IF NOT EXISTS effective_end DATE,
ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_crew_members_employee_id
ON crew_members(employee_id);

CREATE INDEX IF NOT EXISTS idx_crew_members_effective_dates
ON crew_members(crew_id, effective_start, effective_end);

CREATE TABLE IF NOT EXISTS work_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/Chicago',
    week_starts_on INTEGER NOT NULL DEFAULT 0 CHECK (week_starts_on BETWEEN 0 AND 6),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS shift_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_calendar_id UUID NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    crosses_midnight BOOLEAN NOT NULL DEFAULT false,
    paid_minutes INTEGER CHECK (paid_minutes IS NULL OR paid_minutes >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_calendar
ON shift_templates(work_calendar_id, day_of_week);

CREATE TABLE IF NOT EXISTS employee_calendar_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_calendar_id UUID NOT NULL REFERENCES work_calendars(id),
    effective_start DATE NOT NULL,
    effective_end DATE,
    is_primary BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);

CREATE INDEX IF NOT EXISTS idx_employee_calendar_assignments_employee
ON employee_calendar_assignments(employee_id, effective_start, effective_end);

CREATE TABLE IF NOT EXISTS employee_shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_template_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
    shift_date DATE NOT NULL,
    scheduled_start TIMESTAMP NOT NULL,
    scheduled_end TIMESTAMP NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
        status IN ('planned', 'scheduled', 'confirmed', 'worked', 'missed', 'cancelled')
    ),
    source TEXT NOT NULL DEFAULT 'calendar' CHECK (
        source IN ('calendar', 'manual', 'import', 'job')
    ),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (scheduled_end > scheduled_start)
);

CREATE INDEX IF NOT EXISTS idx_employee_shift_assignments_employee_time
ON employee_shift_assignments(employee_id, scheduled_start, scheduled_end);

CREATE INDEX IF NOT EXISTS idx_employee_shift_assignments_date
ON employee_shift_assignments(shift_date, status);

CREATE TABLE IF NOT EXISTS availability_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    availability_type TEXT NOT NULL CHECK (
        availability_type IN ('available', 'unavailable', 'preferred', 'on_call', 'restricted')
    ),
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP NOT NULL,
    reason_code TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_availability_blocks_employee_time
ON availability_blocks(employee_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_availability_blocks_type
ON availability_blocks(availability_type);

CREATE TABLE IF NOT EXISTS time_off_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL,
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (
        status IN ('requested', 'approved', 'denied', 'cancelled')
    ),
    requested_at TIMESTAMP NOT NULL DEFAULT now(),
    reviewed_by_user_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_employee_time
ON time_off_requests(employee_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_status
ON time_off_requests(status);

CREATE TABLE IF NOT EXISTS on_call_rotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (
        status IN ('planned', 'active', 'completed', 'cancelled')
    ),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS on_call_rotation_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    on_call_rotation_id UUID NOT NULL REFERENCES on_call_rotations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
    escalation_minutes INTEGER CHECK (escalation_minutes IS NULL OR escalation_minutes >= 0),
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (on_call_rotation_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_on_call_rotation_members_employee
ON on_call_rotation_members(employee_id);

CREATE OR REPLACE VIEW workforce_roster_view AS
SELECT
    e.id,
    e.employee_number,
    e.display_name,
    e.job_title,
    e.employment_status,
    e.employment_type,
    e.primary_email,
    e.mobile_phone,
    e.dispatch_eligible,
    e.frontline_enabled,
    e.business_unit_id,
    bu.name AS business_unit_name,
    e.manager_employee_id,
    manager.display_name AS manager_name,
    tm.team_id AS primary_team_id,
    team.name AS primary_team_name,
    cm.crew_id AS active_crew_id,
    crew.name AS active_crew_name,
    credential_totals.blocking_record_count,
    credential_totals.expiring_record_count,
    e.created_at,
    e.updated_at
FROM employees e
LEFT JOIN business_units bu ON bu.id = e.business_unit_id
LEFT JOIN employees manager ON manager.id = e.manager_employee_id
LEFT JOIN team_memberships tm
    ON tm.employee_id = e.id
    AND tm.is_primary = true
    AND tm.status = 'active'
    AND tm.deleted_at IS NULL
    AND tm.effective_start <= CURRENT_DATE
    AND (tm.effective_end IS NULL OR tm.effective_end >= CURRENT_DATE)
LEFT JOIN teams team ON team.id = tm.team_id
LEFT JOIN crew_members cm
    ON cm.employee_id = e.id
    AND cm.membership_status = 'active'
    AND cm.deleted_at IS NULL
    AND (cm.effective_start IS NULL OR cm.effective_start <= CURRENT_DATE)
    AND (cm.effective_end IS NULL OR cm.effective_end >= CURRENT_DATE)
LEFT JOIN crews crew ON crew.id = cm.crew_id
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE readiness IN ('blocked', 'expired')) AS blocking_record_count,
        COUNT(*) FILTER (WHERE readiness = 'expiring') AS expiring_record_count
    FROM employee_credential_status_view status_record
    WHERE status_record.employee_id = e.id
) credential_totals ON true
WHERE e.deleted_at IS NULL;
