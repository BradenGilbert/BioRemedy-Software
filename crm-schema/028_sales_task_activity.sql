CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Formalizes two Table Types, matching how this project now classifies
-- every entity going forward:
--
--   Standard  -- owned by user, team, or org. Full relational modeling,
--               joins, auditing, rules. General business entities needing
--               full capabilities (accounts, addresses, vendor_profiles,
--               industries, etc.)
--   Activity  -- owned by user or team. Time-based fields, multi-record
--               association. Tasks, appointments, emails, and interactions
--               (calls, meetings, etc.)
--
-- dataverse_entity_map already exists as this project's table registry
-- (015_dataverse_relationship_foundation.sql), so Table Type is added there
-- as a column rather than a new registry.
--
-- This migration only classifies the tables already tracked in
-- dataverse_entity_map (the Dataverse-alignment layer), not all 132+ tables
-- across crm-schema -- most operational tables (work_orders, job_*, etc.)
-- were never added to that registry either.
ALTER TABLE dataverse_entity_map ADD COLUMN IF NOT EXISTS table_type TEXT NOT NULL DEFAULT 'Standard'
    CHECK (table_type IN ('Standard', 'Activity'));

UPDATE dataverse_entity_map
SET table_type = 'Activity'
WHERE local_table_name IN ('activities', 'activity_parties');

-- Sales Task: a dedicated, Dataverse Task-shaped entity, distinct from:
--   - `tasks` (008_tasks.sql) -- operational work-order checklist items,
--     unrelated to sales/CRM activity tracking. Do not confuse the two.
--   - `activities` (014_activities.sql) -- the existing generic
--     Meeting/Call/Email/Task timeline table. Rows with
--     activity_type = 'Task' there are the legacy representation; new task
--     work should use this table instead. Reconciling/migrating existing
--     Task-type activity rows into sales_tasks is a follow-up data
--     migration, not part of this schema change.
--
-- Regarding is scoped to contacts only, per spec ("Regarding (lookup to
-- contacts table)"), narrower than activities.regarding_object_id's full
-- polymorphic target list. Broaden later with the same
-- object_id/object_logical_name pattern if tasks need to regard accounts,
-- opportunities, etc. directly.
CREATE TABLE IF NOT EXISTS sales_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,

    subject TEXT NOT NULL,
    description TEXT,
    regarding_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    parent_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,

    due_date DATE,
    priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
    activity_status TEXT NOT NULL DEFAULT 'Open' CHECK (activity_status IN ('Open', 'Completed', 'Canceled')),
    -- Free text rather than a CHECK-constrained enum because valid reasons
    -- depend on activity_status (e.g. "Not Started"/"In Progress"/"Waiting
    -- on Someone Else"/"Deferred" while Open, "Completed" or "Canceled" once
    -- closed). Add a stricter constraint later if that pairing needs to be
    -- enforced in SQL.
    status_reason TEXT,
    actual_start TIMESTAMP,
    actual_end TIMESTAMP,

    owner_id UUID,
    owner_logical_name TEXT,
    owning_business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    created_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    modified_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    import_sequence_number INTEGER,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team'))
);

CREATE INDEX IF NOT EXISTS idx_sales_tasks_parent_account ON sales_tasks(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_regarding_contact ON sales_tasks(regarding_contact_id);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_due_date ON sales_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_status ON sales_tasks(activity_status);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_owner ON sales_tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_deleted_at ON sales_tasks(deleted_at);

CREATE OR REPLACE VIEW sales_task_timeline_view AS
SELECT
    t.id,
    t.subject,
    t.priority,
    t.activity_status,
    t.status_reason,
    t.due_date,
    t.actual_start,
    t.actual_end,
    acct.account_name,
    c.full_name AS regarding_contact_name
FROM sales_tasks t
LEFT JOIN accounts acct ON acct.id = t.parent_account_id
LEFT JOIN contacts c ON c.id = t.regarding_contact_id
WHERE t.deleted_at IS NULL;

INSERT INTO dataverse_entity_map (
    local_table_name,
    dataverse_logical_name,
    dataverse_entity_set_name,
    primary_id_attribute,
    primary_name_attribute,
    ownership_type,
    model_status,
    table_type,
    notes
)
VALUES
    ('sales_tasks', 'crm_salestask', 'crm_salestasks', 'crm_salestaskid', 'subject', 'UserOwned', 'foundation', 'Activity', 'Dataverse Task-shaped activity entity. Distinct from tasks (008_tasks.sql, operational) and activities (014_activities.sql, legacy generic timeline).')
ON CONFLICT (local_table_name) DO UPDATE SET
    dataverse_logical_name = EXCLUDED.dataverse_logical_name,
    dataverse_entity_set_name = EXCLUDED.dataverse_entity_set_name,
    primary_id_attribute = EXCLUDED.primary_id_attribute,
    primary_name_attribute = EXCLUDED.primary_name_attribute,
    ownership_type = EXCLUDED.ownership_type,
    model_status = EXCLUDED.model_status,
    table_type = EXCLUDED.table_type,
    notes = EXCLUDED.notes,
    updated_at = now();
