CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Account relationship extensions.
-- Adds maintainable reference tables (account types, industries) instead of
-- hardcoded choice text, a dedicated account-scoped address book, and the
-- relationship-classification columns needed on accounts (client/prospect/
-- vendor/subcontractor flags, customer status, primary relationship).
--
-- `eligible_for_subcontracting` is completed in
-- 027_vendor_subcontractor_management.sql once vendor_profiles exists, since
-- the formula reads vendor compliance fields that live on that table.

CREATE TABLE IF NOT EXISTS account_types (
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

INSERT INTO account_types (name, display_order) VALUES
    ('Commercial', 1),
    ('Municipal / Government', 2),
    ('Industrial', 3),
    ('Residential', 4),
    ('Strategic Partner', 5)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS industries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    industry_name TEXT NOT NULL UNIQUE,
    industry_code TEXT UNIQUE,
    parent_industry_id UUID REFERENCES industries(id) ON DELETE SET NULL,
    industry_category TEXT,
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

CREATE INDEX IF NOT EXISTS idx_industries_parent ON industries(parent_industry_id);
CREATE INDEX IF NOT EXISTS idx_industries_category ON industries(industry_category);

INSERT INTO industries (industry_name, industry_code, display_order) VALUES
    ('Oil & Gas', 'OILGAS', 1),
    ('Agriculture', 'AG', 2),
    ('Wastewater', 'WASTEWATER', 3),
    ('Manufacturing', 'MFG', 4),
    ('Municipal / Government', 'GOVT', 5),
    ('Healthcare', 'HEALTH', 6),
    ('Construction', 'CONSTRUCTION', 7),
    ('Transportation / Logistics', 'TRANSPORT', 8)
ON CONFLICT (industry_name) DO NOTHING;

-- Accounts can operate in more than one industry, so this is a many-to-many
-- junction rather than a single industry_id column on accounts.
CREATE TABLE IF NOT EXISTS account_industries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    industry_id UUID NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (account_id, industry_id)
);

CREATE INDEX IF NOT EXISTS idx_account_industries_account ON account_industries(account_id);
CREATE INDEX IF NOT EXISTS idx_account_industries_industry ON account_industries(industry_id);

-- Account-scoped address book. This is the go-forward source for the
-- account page's address section. accounts.address_one_*/address_two_*/
-- billing_address_* (001_accounts.sql) and the polymorphic
-- customer_addresses table (015_dataverse_relationship_foundation.sql) are
-- left in place but considered legacy for accounts; see the "Superseded"
-- note in dataverse-relationship-architecture.md.
CREATE TABLE IF NOT EXISTS addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    parent_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    address_name TEXT NOT NULL,
    address_type TEXT NOT NULL CHECK (
        address_type IN ('Bill To', 'Ship To', 'Primary', 'Tax', 'Remit-To', 'Vendor Dispatch', 'Vendor Billing', 'Other')
    ),
    is_primary BOOLEAN NOT NULL DEFAULT false,

    suite_number TEXT,
    street_1 TEXT NOT NULL,
    street_2 TEXT,
    street_3 TEXT,
    city TEXT NOT NULL,
    county TEXT,
    state_or_province TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country_or_region TEXT NOT NULL,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),

    freight_terms TEXT,
    shipping_method TEXT,
    delivery_instructions TEXT,
    address_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    phone TEXT,

    state_code TEXT NOT NULL DEFAULT 'Active',
    status_code TEXT,
    import_sequence_number INTEGER,

    owner_id UUID,
    owner_logical_name TEXT,
    owning_business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    created_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    modified_by_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team'))
);

CREATE INDEX IF NOT EXISTS idx_addresses_parent_account ON addresses(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_addresses_type ON addresses(address_type);
CREATE INDEX IF NOT EXISTS idx_addresses_city ON addresses(city);
CREATE INDEX IF NOT EXISTS idx_addresses_postal_code ON addresses(postal_code);
CREATE INDEX IF NOT EXISTS idx_addresses_contact ON addresses(address_contact_id);
CREATE INDEX IF NOT EXISTS idx_addresses_owning_business_unit ON addresses(owning_business_unit_id);
CREATE INDEX IF NOT EXISTS idx_addresses_deleted_at ON addresses(deleted_at);

-- At most one primary address per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_primary_per_account
ON addresses(parent_account_id)
WHERE is_primary = true AND deleted_at IS NULL;

-- Relationship classification on the main accounts table. An account can be
-- more than one of these at once (e.g. client AND vendor AND subcontractor).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_type_id UUID REFERENCES account_types(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tax_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_client BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_prospect BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_vendor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_subcontractor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS eligible_for_subcontracting BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS relationship_status TEXT
    CHECK (relationship_status IN ('Target', 'Active', 'Inactive', 'Suspended'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS primary_relationship TEXT
    CHECK (primary_relationship IN ('Customer', 'Subcontractor', 'Supplier', 'Partner', 'Other'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS customer_status TEXT
    CHECK (customer_status IN ('Never purchased', 'Active customer', 'Inactive customer', 'Former customer', 'On hold'))
    DEFAULT 'Never purchased';

CREATE INDEX IF NOT EXISTS idx_accounts_account_type ON accounts(account_type_id);
CREATE INDEX IF NOT EXISTS idx_accounts_tax_address ON accounts(tax_address_id);
CREATE INDEX IF NOT EXISTS idx_accounts_relationship_status ON accounts(relationship_status);
CREATE INDEX IF NOT EXISTS idx_accounts_customer_status ON accounts(customer_status);
CREATE INDEX IF NOT EXISTS idx_accounts_is_vendor ON accounts(is_vendor);
CREATE INDEX IF NOT EXISTS idx_accounts_is_subcontractor ON accounts(is_subcontractor);

-- Is Client tracks Customer Status automatically rather than being set by
-- hand: Active, Inactive, and Former customers are all still "a client" for
-- filtering purposes, only "Never purchased" and "On hold" are not.
CREATE OR REPLACE FUNCTION sync_account_is_client() RETURNS TRIGGER AS $$
BEGIN
    NEW.is_client := NEW.customer_status IN ('Active customer', 'Inactive customer', 'Former customer');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_sync_is_client ON accounts;
CREATE TRIGGER accounts_sync_is_client
BEFORE INSERT OR UPDATE OF customer_status ON accounts
FOR EACH ROW EXECUTE FUNCTION sync_account_is_client();

-- Register the new tables. Simple single-target lookups above (parent_account_id,
-- address_contact_id, account_type_id, parent_industry_id) are plain SQL
-- foreign keys and do not need dataverse_relationship_definitions rows per
-- rule 4 in dataverse-relationship-architecture.md; only polymorphic-style
-- references get metadata rows.
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
    ('account_types', 'crm_accounttype', 'crm_accounttypes', 'crm_accounttypeid', 'name', 'OrganizationOwned', 'foundation', 'Maintainable account type picklist referenced from accounts.account_type_id.'),
    ('industries', 'crm_industry', 'crm_industries', 'crm_industryid', 'industry_name', 'OrganizationOwned', 'foundation', 'Maintainable industry picklist with optional self-referencing hierarchy.'),
    ('account_industries', 'crm_accountindustry', 'crm_accountindustries', 'crm_accountindustryid', 'crm_accountindustryid', 'None', 'foundation', 'Account-to-industry many-to-many association.'),
    ('addresses', 'crm_address', 'crm_addresses', 'crm_addressid', 'address_name', 'UserOwned', 'foundation', 'Account-scoped address book with freight, shipping, and geocode fields. Go-forward source for the account page address section.')
ON CONFLICT (local_table_name) DO UPDATE SET
    dataverse_logical_name = EXCLUDED.dataverse_logical_name,
    dataverse_entity_set_name = EXCLUDED.dataverse_entity_set_name,
    primary_id_attribute = EXCLUDED.primary_id_attribute,
    primary_name_attribute = EXCLUDED.primary_name_attribute,
    ownership_type = EXCLUDED.ownership_type,
    model_status = EXCLUDED.model_status,
    notes = EXCLUDED.notes,
    updated_at = now();
