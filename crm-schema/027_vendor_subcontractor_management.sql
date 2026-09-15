CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Vendor and subcontractor management.
-- Fills the gap called out in database-handoff-map.md Priority 1 #4:
-- "Vendors can currently be represented as accounts, but their operational
-- compliance is not modeled."
--
-- vendor_profiles is a 1:1 extension of accounts, not a duplicate of it: an
-- account can be Is Client = Yes AND Is Vendor = Yes AND Is Subcontractor =
-- Yes at the same time, and this table only carries the vendor-specific
-- compliance/onboarding facts. Company identity, addresses, and contacts
-- stay on accounts/contacts/addresses and are read through
-- parent_account_id via vendor_profile_detail_view, so an address edit on
-- the account can never leave a stale copy here.
--
-- subcontractor_assignments is deliberately NOT wired into the operations/
-- dispatch schema (022_jobs_dispatch_assignments.sql) yet. See the
-- forward-looking notes added to erp-operational-architecture.md and
-- database-handoff-map.md.

CREATE TABLE IF NOT EXISTS subcontractor_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    display_order INTEGER,
    state_code TEXT NOT NULL DEFAULT 'Active',
    status_code TEXT,
    created_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    modified_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

INSERT INTO subcontractor_types (name, display_order) VALUES
    ('Subcontractor', 1),
    ('Supplier', 2),
    ('Carrier', 3),
    ('Consultant', 4)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS vendor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    parent_account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,

    vendor_number TEXT UNIQUE,
    subcontractor_type_id UUID REFERENCES subcontractor_types(id) ON DELETE SET NULL,
    onboarding_status TEXT NOT NULL DEFAULT 'Candidate' CHECK (
        onboarding_status IN ('Candidate', 'Pending', 'Approved', 'Suspended', 'Inactive')
    ),
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    approval_date DATE,
    approved_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,

    w9_status TEXT NOT NULL DEFAULT 'Missing' CHECK (w9_status IN ('Missing', 'Received', 'Expired')),
    insurance_status TEXT CHECK (insurance_status IN ('Valid', 'Expiring', 'Expired', 'Waived')),
    insurance_expiration DATE,
    safety_status TEXT NOT NULL DEFAULT 'Pending' CHECK (safety_status IN ('Pending', 'Approved', 'Rejected')),

    payment_terms TEXT,
    -- "Default Rate Card" reuses the existing price_levels entity
    -- (015_dataverse_relationship_foundation.sql) instead of introducing a
    -- parallel Rate Card concept.
    default_price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,
    -- No dedicated Territory table exists yet; kept as plain text until one
    -- is needed.
    service_territory TEXT,
    performance_rating NUMERIC(3,2),
    accounting_vendor_id TEXT,

    -- These should point to addresses/contacts rows that share this
    -- profile's parent_account_id; not enforced by constraint, just
    -- convention (see modeling note in dataverse-relationship-architecture.md).
    remit_to_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
    dispatch_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
    billing_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
    operations_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

    notes TEXT,

    owner_id UUID,
    owner_logical_name TEXT,
    owning_business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    created_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    modified_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    import_sequence_number INTEGER,
    state_code TEXT NOT NULL DEFAULT 'Active',
    status_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_profiles_subcontractor_type ON vendor_profiles(subcontractor_type_id);
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_onboarding_status ON vendor_profiles(onboarding_status);
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_insurance_expiration ON vendor_profiles(insurance_expiration);
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_deleted_at ON vendor_profiles(deleted_at);

-- Read-only convenience view: the Vendor Profile page should read company
-- identity, addresses, and contacts through this view instead of ever
-- storing a second copy of them on vendor_profiles.
CREATE OR REPLACE VIEW vendor_profile_detail_view AS
SELECT
    vp.id AS vendor_profile_id,
    vp.parent_account_id,
    a.account_name AS company_name,
    a.main_phone_number,
    a.website,
    a.email AS general_email,
    a.owner_name AS account_owner_name,
    a.parent_account_id AS parent_company_id,
    tax_addr.address_name AS tax_address_name,
    vp.vendor_number,
    st.name AS subcontractor_type,
    vp.onboarding_status,
    vp.is_suspended,
    vp.insurance_status,
    vp.insurance_expiration,
    vp.w9_status,
    vp.safety_status,
    a.is_subcontractor,
    a.eligible_for_subcontracting,
    remit.address_name AS remit_to_address_name,
    dispatch.address_name AS dispatch_address_name,
    billing.address_name AS billing_address_name,
    oc.full_name AS operations_contact_name,
    oc.mobile_phone AS operations_contact_phone
FROM vendor_profiles vp
JOIN accounts a ON a.id = vp.parent_account_id
LEFT JOIN subcontractor_types st ON st.id = vp.subcontractor_type_id
LEFT JOIN addresses tax_addr ON tax_addr.id = a.tax_address_id
LEFT JOIN addresses remit ON remit.id = vp.remit_to_address_id
LEFT JOIN addresses dispatch ON dispatch.id = vp.dispatch_address_id
LEFT JOIN addresses billing ON billing.id = vp.billing_address_id
LEFT JOIN contacts oc ON oc.id = vp.operations_contact_id
WHERE vp.deleted_at IS NULL
  AND a.deleted_at IS NULL;

-- No column spec was given for this table; this is a reasonable starting
-- shape covering the MSA/rate-agreement concepts already referenced in
-- database-handoff-map.md ("Customer contracts and rate agreements").
CREATE TABLE IF NOT EXISTS service_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    parent_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    agreement_name TEXT NOT NULL,
    agreement_number TEXT UNIQUE,
    agreement_type TEXT CHECK (agreement_type IN ('MSA', 'Standing Work Order', 'Rate Agreement', 'Other')),
    agreement_status TEXT NOT NULL DEFAULT 'Draft' CHECK (
        agreement_status IN ('Draft', 'Active', 'Expired', 'Terminated', 'Renewed')
    ),

    effective_start DATE,
    effective_end DATE,
    auto_renew BOOLEAN NOT NULL DEFAULT false,
    renewal_term_months INTEGER,

    payment_terms TEXT,
    billing_frequency TEXT,
    price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    total_contract_value NUMERIC(14,2),
    scope_of_work TEXT,
    signed_document_annotation_id UUID REFERENCES annotations(id) ON DELETE SET NULL,

    owner_id UUID,
    owner_logical_name TEXT,
    owning_business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    created_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    modified_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    import_sequence_number INTEGER,
    state_code TEXT NOT NULL DEFAULT 'Active',
    status_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team'))
);

CREATE INDEX IF NOT EXISTS idx_service_agreements_parent_account ON service_agreements(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_service_agreements_status ON service_agreements(agreement_status);
CREATE INDEX IF NOT EXISTS idx_service_agreements_effective_end ON service_agreements(effective_end);

-- No column spec was given for this table either. Kept independent of the
-- job/dispatch schema for now -- see the planning notes referenced above.
CREATE TABLE IF NOT EXISTS subcontractor_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    vendor_profile_id UUID NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,

    assignment_name TEXT NOT NULL,
    assignment_status TEXT NOT NULL DEFAULT 'Requested' CHECK (
        assignment_status IN ('Requested', 'Confirmed', 'In Progress', 'Complete', 'Canceled')
    ),
    scope_of_work TEXT,
    rate_type TEXT CHECK (rate_type IN ('Hourly', 'Flat', 'Unit-based', 'Time and Materials')),
    rate_amount NUMERIC(14,2),
    price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,

    start_date DATE,
    end_date DATE,
    notes TEXT,

    -- Intentionally not a foreign key yet -- job/dispatch tables don't
    -- point here yet either. See the planning notes in
    -- erp-operational-architecture.md and database-handoff-map.md.
    related_job_reference TEXT,

    owner_id UUID,
    owner_logical_name TEXT,
    owning_business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    created_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    modified_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    import_sequence_number INTEGER,
    state_code TEXT NOT NULL DEFAULT 'Active',
    status_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team'))
);

CREATE INDEX IF NOT EXISTS idx_subcontractor_assignments_vendor_profile ON subcontractor_assignments(vendor_profile_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_assignments_status ON subcontractor_assignments(assignment_status);

-- accounts.eligible_for_subcontracting (added in
-- 026_account_relationship_extensions.sql) is system-calculated, per:
--   Eligible for Subcontracting =
--     Vendor Profile is approved
--     AND Is Subcontractor = Yes
--     AND Insurance is valid
--     AND W-9 is received
--     AND Safety status is approved
--     AND Vendor is not suspended
-- It is kept in sync by trigger rather than left for an app-tier job, since
-- this schema layer has no other automation/workflow engine yet.
CREATE OR REPLACE FUNCTION recalculate_account_subcontracting_eligibility(p_account_id UUID) RETURNS VOID AS $$
BEGIN
    UPDATE accounts a
    SET eligible_for_subcontracting = COALESCE((
        SELECT
            a.is_subcontractor
            AND vp.onboarding_status = 'Approved'
            AND vp.insurance_status = 'Valid'
            AND vp.w9_status = 'Received'
            AND vp.safety_status = 'Approved'
            AND NOT vp.is_suspended
        FROM vendor_profiles vp
        WHERE vp.parent_account_id = a.id
          AND vp.deleted_at IS NULL
    ), false)
    WHERE a.id = p_account_id;
END;
$$ LANGUAGE plpgsql;

-- Branches on TG_OP rather than COALESCE(NEW.col, OLD.col): PL/pgSQL raises
-- "record 'new' is not assigned yet" if NEW's fields are touched at all
-- during a DELETE (and likewise for OLD during a plain INSERT).
CREATE OR REPLACE FUNCTION trg_vendor_profiles_sync_eligibility() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recalculate_account_subcontracting_eligibility(OLD.parent_account_id);
        RETURN OLD;
    END IF;
    -- Reparenting a vendor profile to a different account is rare, but if it
    -- happens the old account should lose its eligibility too. Nested IF
    -- (not a combined AND) so OLD is never referenced outside an UPDATE.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.parent_account_id IS DISTINCT FROM NEW.parent_account_id THEN
            PERFORM recalculate_account_subcontracting_eligibility(OLD.parent_account_id);
        END IF;
    END IF;
    PERFORM recalculate_account_subcontracting_eligibility(NEW.parent_account_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vendor_profiles_sync_eligibility ON vendor_profiles;
CREATE TRIGGER vendor_profiles_sync_eligibility
AFTER INSERT OR UPDATE OF onboarding_status, insurance_status, w9_status, safety_status, is_suspended, parent_account_id, deleted_at OR DELETE
ON vendor_profiles
FOR EACH ROW EXECUTE FUNCTION trg_vendor_profiles_sync_eligibility();

CREATE OR REPLACE FUNCTION trg_accounts_sync_eligibility() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_subcontractor IS DISTINCT FROM OLD.is_subcontractor THEN
        PERFORM recalculate_account_subcontracting_eligibility(NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_sync_eligibility_on_subcontractor_flag ON accounts;
CREATE TRIGGER accounts_sync_eligibility_on_subcontractor_flag
AFTER UPDATE OF is_subcontractor ON accounts
FOR EACH ROW EXECUTE FUNCTION trg_accounts_sync_eligibility();

INSERT INTO dataverse_entity_map (
    local_table_name,
    dataverse_logical_name,
    dataverse_entity_set_name,
    primary_id_attribute,
    primary_name_attribute,
    ownership_type,
    model_status,
    notes
)
VALUES
    ('subcontractor_types', 'crm_subcontractortype', 'crm_subcontractortypes', 'crm_subcontractortypeid', 'name', 'OrganizationOwned', 'foundation', 'Maintainable picklist backing vendor_profiles.subcontractor_type_id.'),
    ('vendor_profiles', 'crm_vendorprofile', 'crm_vendorprofiles', 'crm_vendorprofileid', 'vendor_number', 'UserOwned', 'foundation', '1:1 vendor/subcontractor compliance extension of accounts. Do not duplicate account identity fields here; read them via vendor_profile_detail_view.'),
    ('service_agreements', 'crm_serviceagreement', 'crm_serviceagreements', 'crm_serviceagreementid', 'agreement_name', 'UserOwned', 'foundation', 'Account-level MSA/rate-agreement header. Column list is a first draft, no spec was given.'),
    ('subcontractor_assignments', 'crm_subcontractorassignment', 'crm_subcontractorassignments', 'crm_subcontractorassignmentid', 'assignment_name', 'UserOwned', 'foundation', 'Job-specific subcontractor engagement. Column list is a first draft; not yet linked to job/dispatch tables, see planning notes.')
ON CONFLICT (local_table_name) DO UPDATE SET
    dataverse_logical_name = EXCLUDED.dataverse_logical_name,
    dataverse_entity_set_name = EXCLUDED.dataverse_entity_set_name,
    primary_id_attribute = EXCLUDED.primary_id_attribute,
    primary_name_attribute = EXCLUDED.primary_name_attribute,
    ownership_type = EXCLUDED.ownership_type,
    model_status = EXCLUDED.model_status,
    notes = EXCLUDED.notes,
    updated_at = now();
