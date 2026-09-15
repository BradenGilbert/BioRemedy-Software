CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Dataverse-style relationship foundation.
-- This layer keeps relationship metadata explicit and avoids forcing one SQL FK
-- onto Dataverse lookup types that can point to more than one table.

CREATE TABLE IF NOT EXISTS dataverse_entity_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_table_name TEXT NOT NULL UNIQUE,
    dataverse_logical_name TEXT NOT NULL UNIQUE,
    dataverse_entity_set_name TEXT,
    primary_id_attribute TEXT NOT NULL,
    primary_name_attribute TEXT,
    ownership_type TEXT NOT NULL DEFAULT 'UserOwned',
    model_status TEXT NOT NULL DEFAULT 'modeled',
    notes TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataverse_relationship_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_name TEXT NOT NULL UNIQUE,
    relationship_type TEXT NOT NULL CHECK (
        relationship_type IN ('lookup', 'customer', 'owner', 'partylist', 'regarding', 'polymorphic', 'many_to_many')
    ),
    referencing_logical_name TEXT NOT NULL,
    referencing_attribute TEXT NOT NULL,
    referenced_logical_names TEXT[] NOT NULL,
    referenced_attribute TEXT NOT NULL DEFAULT 'id',
    local_table_name TEXT,
    local_column_name TEXT,
    local_type_column_name TEXT,
    is_polymorphic BOOLEAN NOT NULL DEFAULT false,
    cascade_notes TEXT,
    modeling_notes TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dv_relationships_referencing
ON dataverse_relationship_definitions(referencing_logical_name, referencing_attribute);

CREATE INDEX IF NOT EXISTS idx_dv_relationships_targets
ON dataverse_relationship_definitions USING GIN (referenced_logical_names);

CREATE TABLE IF NOT EXISTS crm_relationship_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_schema_name TEXT REFERENCES dataverse_relationship_definitions(schema_name) ON DELETE SET NULL,
    source_logical_name TEXT NOT NULL,
    source_id UUID NOT NULL,
    source_attribute TEXT,
    target_logical_name TEXT NOT NULL,
    target_id UUID NOT NULL,
    target_name TEXT,
    role_name TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    effective_start TIMESTAMP,
    effective_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (source_logical_name, source_id, source_attribute, target_logical_name, target_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_crm_edges_source
ON crm_relationship_edges(source_logical_name, source_id);

CREATE INDEX IF NOT EXISTS idx_crm_edges_target
ON crm_relationship_edges(target_logical_name, target_id);

CREATE INDEX IF NOT EXISTS idx_crm_edges_schema
ON crm_relationship_edges(relationship_schema_name);

CREATE TABLE IF NOT EXISTS transaction_currencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    currency_name TEXT NOT NULL,
    currency_code TEXT NOT NULL UNIQUE,
    currency_symbol TEXT,
    exchange_rate NUMERIC(18,8),
    precision_value INTEGER,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS business_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    name TEXT NOT NULL,
    parent_business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS system_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    domain_name TEXT,
    internal_email_address TEXT,
    title TEXT,
    is_disabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    team_type TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS unit_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    name TEXT NOT NULL,
    base_uom_name TEXT,
    state_code TEXT,
    status_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS units_of_measure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    unit_group_id UUID REFERENCES unit_groups(id) ON DELETE SET NULL,
    base_uom_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    quantity NUMERIC(18,6),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS price_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    begin_date DATE,
    end_date DATE,
    state_code TEXT,
    status_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    default_uom_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    default_unit_group_id UUID REFERENCES unit_groups(id) ON DELETE SET NULL,
    parent_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    product_number TEXT,
    product_structure TEXT,
    description TEXT,
    state_code TEXT,
    status_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS product_price_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    price_level_id UUID REFERENCES price_levels(id) ON DELETE CASCADE,
    uom_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    unit_group_id UUID REFERENCES unit_groups(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    amount NUMERIC(14,2),
    pricing_method_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (product_id, price_level_id, uom_id)
);

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    owner_id UUID,
    owner_logical_name TEXT,
    customer_id UUID,
    customer_logical_name TEXT,
    parent_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    parent_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    qualifying_opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    subject TEXT,
    full_name TEXT,
    first_name TEXT,
    last_name TEXT,
    company_name TEXT,
    email TEXT,
    telephone TEXT,
    lead_source TEXT,
    budget_amount NUMERIC(14,2),
    estimated_value NUMERIC(14,2),
    description TEXT,
    state_code TEXT,
    status_code TEXT,
    created_by TEXT,
    created_on TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team')),
    CHECK (customer_logical_name IS NULL OR customer_logical_name IN ('account', 'contact'))
);

CREATE INDEX IF NOT EXISTS idx_leads_customer
ON leads(customer_logical_name, customer_id);

CREATE INDEX IF NOT EXISTS idx_leads_parent_account
ON leads(parent_account_id);

CREATE INDEX IF NOT EXISTS idx_leads_parent_contact
ON leads(parent_contact_id);

CREATE TABLE IF NOT EXISTS customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    parent_id UUID NOT NULL,
    parent_logical_name TEXT NOT NULL CHECK (parent_logical_name IN ('account', 'contact')),
    address_number INTEGER,
    address_type TEXT,
    name TEXT,
    line_one TEXT,
    line_two TEXT,
    line_three TEXT,
    city TEXT,
    state_or_province TEXT,
    postal_code TEXT,
    country TEXT,
    county TEXT,
    post_office_box TEXT,
    telephone_one TEXT,
    telephone_two TEXT,
    telephone_three TEXT,
    fax TEXT,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    ups_zone TEXT,
    utc_offset TEXT,
    freight_terms TEXT,
    shipping_method TEXT,
    primary_contact_name TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_parent
ON customer_addresses(parent_logical_name, parent_id);

CREATE TABLE IF NOT EXISTS opportunity_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    uom_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    parent_bundle_id UUID REFERENCES opportunity_products(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    product_name TEXT,
    product_description TEXT,
    is_product_overridden BOOLEAN NOT NULL DEFAULT false,
    quantity NUMERIC(18,4),
    price_per_unit NUMERIC(14,2),
    extended_amount NUMERIC(14,2),
    manual_discount_amount NUMERIC(14,2),
    tax NUMERIC(14,2),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_opportunity_products_opportunity
ON opportunity_products(opportunity_id);

CREATE TABLE IF NOT EXISTS quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    owner_id UUID,
    owner_logical_name TEXT,
    customer_id UUID,
    customer_logical_name TEXT,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    quote_number TEXT,
    name TEXT NOT NULL,
    description TEXT,
    total_amount NUMERIC(14,2),
    total_amount_base NUMERIC(14,2),
    effective_from DATE,
    effective_to DATE,
    state_code TEXT,
    status_code TEXT,
    bill_to_name TEXT,
    bill_to_line_one TEXT,
    bill_to_city TEXT,
    bill_to_state_or_province TEXT,
    bill_to_postal_code TEXT,
    bill_to_country TEXT,
    ship_to_name TEXT,
    ship_to_line_one TEXT,
    ship_to_city TEXT,
    ship_to_state_or_province TEXT,
    ship_to_postal_code TEXT,
    ship_to_country TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team')),
    CHECK (customer_logical_name IS NULL OR customer_logical_name IN ('account', 'contact'))
);

CREATE INDEX IF NOT EXISTS idx_quotes_customer
ON quotes(customer_logical_name, customer_id);

CREATE INDEX IF NOT EXISTS idx_quotes_opportunity
ON quotes(opportunity_id);

CREATE TABLE IF NOT EXISTS quote_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    uom_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    parent_bundle_id UUID REFERENCES quote_lines(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    sales_rep_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    product_name TEXT,
    product_description TEXT,
    is_product_overridden BOOLEAN NOT NULL DEFAULT false,
    quantity NUMERIC(18,4),
    price_per_unit NUMERIC(14,2),
    extended_amount NUMERIC(14,2),
    manual_discount_amount NUMERIC(14,2),
    tax NUMERIC(14,2),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_quote_lines_quote
ON quote_lines(quote_id);

CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    owner_id UUID,
    owner_logical_name TEXT,
    customer_id UUID,
    customer_logical_name TEXT,
    quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    order_number TEXT,
    name TEXT NOT NULL,
    description TEXT,
    total_amount NUMERIC(14,2),
    total_amount_base NUMERIC(14,2),
    date_fulfilled DATE,
    state_code TEXT,
    status_code TEXT,
    bill_to_name TEXT,
    ship_to_name TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team')),
    CHECK (customer_logical_name IS NULL OR customer_logical_name IN ('account', 'contact'))
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_customer
ON sales_orders(customer_logical_name, customer_id);

CREATE INDEX IF NOT EXISTS idx_sales_orders_quote
ON sales_orders(quote_id);

CREATE TABLE IF NOT EXISTS sales_order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
    quote_line_id UUID REFERENCES quote_lines(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    uom_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    parent_bundle_id UUID REFERENCES sales_order_lines(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    sales_rep_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    product_name TEXT,
    product_description TEXT,
    is_product_overridden BOOLEAN NOT NULL DEFAULT false,
    quantity NUMERIC(18,4),
    price_per_unit NUMERIC(14,2),
    extended_amount NUMERIC(14,2),
    manual_discount_amount NUMERIC(14,2),
    tax NUMERIC(14,2),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_order_lines_order
ON sales_order_lines(sales_order_id);

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    owner_id UUID,
    owner_logical_name TEXT,
    customer_id UUID,
    customer_logical_name TEXT,
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    invoice_number TEXT,
    name TEXT NOT NULL,
    description TEXT,
    total_amount NUMERIC(14,2),
    total_amount_base NUMERIC(14,2),
    due_date DATE,
    paid_date DATE,
    state_code TEXT,
    status_code TEXT,
    bill_to_name TEXT,
    ship_to_name TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team')),
    CHECK (customer_logical_name IS NULL OR customer_logical_name IN ('account', 'contact'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer
ON invoices(customer_logical_name, customer_id);

CREATE INDEX IF NOT EXISTS idx_invoices_sales_order
ON invoices(sales_order_id);

CREATE INDEX IF NOT EXISTS idx_invoices_opportunity
ON invoices(opportunity_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    sales_order_line_id UUID REFERENCES sales_order_lines(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    uom_id UUID REFERENCES units_of_measure(id) ON DELETE SET NULL,
    parent_bundle_id UUID REFERENCES invoice_lines(id) ON DELETE SET NULL,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    sales_rep_id UUID REFERENCES system_users(id) ON DELETE SET NULL,
    product_name TEXT,
    product_description TEXT,
    is_product_overridden BOOLEAN NOT NULL DEFAULT false,
    quantity NUMERIC(18,4),
    price_per_unit NUMERIC(14,2),
    extended_amount NUMERIC(14,2),
    manual_discount_amount NUMERIC(14,2),
    tax NUMERIC(14,2),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS competitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    website_url TEXT,
    reference_info_url TEXT,
    ticker_symbol TEXT,
    stock_exchange TEXT,
    strengths TEXT,
    weaknesses TEXT,
    threats TEXT,
    win_percentage NUMERIC(5,2),
    reported_revenue NUMERIC(14,2),
    reporting_quarter INTEGER,
    reporting_year INTEGER,
    state_code TEXT,
    status_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS opportunity_competitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
    competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
    name TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (opportunity_id, competitor_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_competitors_opportunity
ON opportunity_competitors(opportunity_id);

CREATE TABLE IF NOT EXISTS activity_parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
    party_id UUID,
    party_logical_name TEXT,
    participation_type TEXT,
    address_used TEXT,
    display_name TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_parties_activity
ON activity_parties(activity_id);

CREATE INDEX IF NOT EXISTS idx_activity_parties_party
ON activity_parties(party_logical_name, party_id);

CREATE TABLE IF NOT EXISTS annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    object_id UUID NOT NULL,
    object_logical_name TEXT NOT NULL,
    owner_id UUID,
    owner_logical_name TEXT,
    subject TEXT,
    note_text TEXT,
    filename TEXT,
    mimetype TEXT,
    filesize BIGINT,
    document_body TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team'))
);

CREATE INDEX IF NOT EXISTS idx_annotations_object
ON annotations(object_logical_name, object_id);

CREATE TABLE IF NOT EXISTS connection_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataverse_row_id UUID UNIQUE,
    owner_id UUID,
    owner_logical_name TEXT,
    record_one_id UUID NOT NULL,
    record_one_logical_name TEXT NOT NULL,
    record_one_role_id UUID REFERENCES connection_roles(id) ON DELETE SET NULL,
    record_two_id UUID NOT NULL,
    record_two_logical_name TEXT NOT NULL,
    record_two_role_id UUID REFERENCES connection_roles(id) ON DELETE SET NULL,
    name TEXT,
    description TEXT,
    effective_start TIMESTAMP,
    effective_end TIMESTAMP,
    state_code TEXT,
    status_code TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    CHECK (owner_logical_name IS NULL OR owner_logical_name IN ('systemuser', 'team'))
);

CREATE INDEX IF NOT EXISTS idx_connections_record_one
ON connections(record_one_logical_name, record_one_id);

CREATE INDEX IF NOT EXISTS idx_connections_record_two
ON connections(record_two_logical_name, record_two_id);

CREATE TABLE IF NOT EXISTS opportunity_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    relationship_role TEXT,
    influence_level TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    UNIQUE (opportunity_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_contacts_opportunity
ON opportunity_contacts(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_contacts_contact
ON opportunity_contacts(contact_id);

-- Add Dataverse-compatible relationship columns to the prototype's existing core tables.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS dataverse_row_id UUID UNIQUE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner_logical_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS dataverse_version_number BIGINT;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dataverse_row_id UUID UNIQUE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS parent_customer_id UUID;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS parent_customer_logical_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_logical_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dataverse_version_number BIGINT;

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS dataverse_row_id UUID UNIQUE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS customer_logical_name TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS parent_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS price_level_id UUID REFERENCES price_levels(id) ON DELETE SET NULL;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS transaction_currency_id UUID REFERENCES transaction_currencies(id) ON DELETE SET NULL;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS owner_logical_name TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS dataverse_version_number BIGINT;

ALTER TABLE activities ADD COLUMN IF NOT EXISTS dataverse_row_id UUID UNIQUE;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS regarding_object_id UUID;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS regarding_object_logical_name TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS owner_logical_name TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMP;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMP;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS actual_start TIMESTAMP;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS actual_end TIMESTAMP;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS dataverse_version_number BIGINT;

CREATE INDEX IF NOT EXISTS idx_accounts_dataverse_row_id
ON accounts(dataverse_row_id) WHERE dataverse_row_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_parent_account
ON accounts(parent_account_id);

CREATE INDEX IF NOT EXISTS idx_accounts_primary_contact
ON accounts(primary_contact_id);

CREATE INDEX IF NOT EXISTS idx_contacts_parent_customer
ON contacts(parent_customer_logical_name, parent_customer_id);

CREATE INDEX IF NOT EXISTS idx_opportunities_customer
ON opportunities(customer_logical_name, customer_id);

CREATE INDEX IF NOT EXISTS idx_activities_regarding
ON activities(regarding_object_logical_name, regarding_object_id);

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
    ('accounts', 'account', 'accounts', 'accountid', 'name', 'UserOwned', 'existing-augmented', 'Customer account master.'),
    ('contacts', 'contact', 'contacts', 'contactid', 'fullname', 'UserOwned', 'existing-augmented', 'Individual contact master.'),
    ('customer_addresses', 'customeraddress', 'customeraddresses', 'customeraddressid', 'name', 'OrganizationOwned', 'foundation', 'Polymorphic address rows for accounts and contacts.'),
    ('leads', 'lead', 'leads', 'leadid', 'subject', 'UserOwned', 'foundation', 'Lead capture and qualification source for opportunities.'),
    ('opportunities', 'opportunity', 'opportunities', 'opportunityid', 'name', 'UserOwned', 'existing-augmented', 'Sales opportunity pipeline.'),
    ('opportunity_products', 'opportunityproduct', 'opportunityproducts', 'opportunityproductid', 'productname', 'OrganizationOwned', 'foundation', 'Opportunity line items.'),
    ('quotes', 'quote', 'quotes', 'quoteid', 'name', 'UserOwned', 'foundation', 'Customer quote header.'),
    ('quote_lines', 'quotedetail', 'quotedetails', 'quotedetailid', 'productname', 'OrganizationOwned', 'foundation', 'Quote line item.'),
    ('sales_orders', 'salesorder', 'salesorders', 'salesorderid', 'name', 'UserOwned', 'foundation', 'Sales order header.'),
    ('sales_order_lines', 'salesorderdetail', 'salesorderdetails', 'salesorderdetailid', 'productname', 'OrganizationOwned', 'foundation', 'Sales order line item.'),
    ('invoices', 'invoice', 'invoices', 'invoiceid', 'name', 'UserOwned', 'foundation', 'Invoice header.'),
    ('invoice_lines', 'invoicedetail', 'invoicedetails', 'invoicedetailid', 'productname', 'OrganizationOwned', 'foundation', 'Invoice line item.'),
    ('products', 'product', 'products', 'productid', 'name', 'OrganizationOwned', 'foundation', 'Product catalog.'),
    ('price_levels', 'pricelevel', 'pricelevels', 'pricelevelid', 'name', 'OrganizationOwned', 'foundation', 'Price list.'),
    ('product_price_levels', 'productpricelevel', 'productpricelevels', 'productpricelevelid', 'productpricelevelid', 'OrganizationOwned', 'foundation', 'Product-price list intersection.'),
    ('units_of_measure', 'uom', 'uoms', 'uomid', 'name', 'OrganizationOwned', 'foundation', 'Unit of measure.'),
    ('unit_groups', 'uomschedule', 'uomschedules', 'uomscheduleid', 'name', 'OrganizationOwned', 'foundation', 'Unit group.'),
    ('competitors', 'competitor', 'competitors', 'competitorid', 'name', 'UserOwned', 'foundation', 'Sales competitor records.'),
    ('opportunity_competitors', 'opportunitycompetitors', 'opportunitycompetitorscollection', 'opportunitycompetitorid', 'name', 'None', 'foundation', 'Opportunity-competitor many-to-many association.'),
    ('activities', 'activitypointer', 'activitypointers', 'activityid', 'subject', 'UserOwned', 'existing-augmented', 'Common activity timeline table.'),
    ('activity_parties', 'activityparty', 'activityparties', 'activitypartyid', 'partyidname', 'None', 'foundation', 'Activity participant party list.'),
    ('annotations', 'annotation', 'annotations', 'annotationid', 'subject', 'UserOwned', 'foundation', 'Notes and attachments.'),
    ('connections', 'connection', 'connections', 'connectionid', 'name', 'UserOwned', 'foundation', 'Generic connectable record relationship.'),
    ('system_users', 'systemuser', 'systemusers', 'systemuserid', 'fullname', 'UserOwned', 'foundation', 'User owner target.'),
    ('teams', 'team', 'teams', 'teamid', 'name', 'OrganizationOwned', 'foundation', 'Team owner target.'),
    ('transaction_currencies', 'transactioncurrency', 'transactioncurrencies', 'transactioncurrencyid', 'currencyname', 'OrganizationOwned', 'foundation', 'Currency target for money fields.')
ON CONFLICT (local_table_name) DO UPDATE SET
    dataverse_logical_name = EXCLUDED.dataverse_logical_name,
    dataverse_entity_set_name = EXCLUDED.dataverse_entity_set_name,
    primary_id_attribute = EXCLUDED.primary_id_attribute,
    primary_name_attribute = EXCLUDED.primary_name_attribute,
    ownership_type = EXCLUDED.ownership_type,
    model_status = EXCLUDED.model_status,
    notes = EXCLUDED.notes,
    updated_at = now();

INSERT INTO dataverse_relationship_definitions (
    schema_name,
    relationship_type,
    referencing_logical_name,
    referencing_attribute,
    referenced_logical_names,
    referenced_attribute,
    local_table_name,
    local_column_name,
    local_type_column_name,
    is_polymorphic,
    cascade_notes,
    modeling_notes
)
VALUES
    ('account_parent_account', 'lookup', 'account', 'parentaccountid', ARRAY['account'], 'accountid', 'accounts', 'parent_account_id', NULL, false, 'Query Dataverse metadata for cascade behavior.', 'Account hierarchy self-reference.'),
    ('account_primary_contact', 'lookup', 'account', 'primarycontactid', ARRAY['contact'], 'contactid', 'accounts', 'primary_contact_id', NULL, false, 'Usually set null on contact delete.', 'Primary contact for account.'),
    ('account_owner', 'owner', 'account', 'ownerid', ARRAY['systemuser','team'], 'id', 'accounts', 'owner_id', 'owner_logical_name', true, 'Owner cascade is Dataverse-managed.', 'Use id plus owner_logical_name.'),
    ('account_currency', 'lookup', 'account', 'transactioncurrencyid', ARRAY['transactioncurrency'], 'transactioncurrencyid', 'accounts', 'transaction_currency_id', NULL, false, 'Restrict/delete behavior comes from metadata.', 'Currency for money fields.'),
    ('contact_parent_customer', 'customer', 'contact', 'parentcustomerid', ARRAY['account','contact'], 'id', 'contacts', 'parent_customer_id', 'parent_customer_logical_name', true, 'Customer lookup cascade is Dataverse-managed.', 'Usually parent account, but keep polymorphic.'),
    ('contact_owner', 'owner', 'contact', 'ownerid', ARRAY['systemuser','team'], 'id', 'contacts', 'owner_id', 'owner_logical_name', true, 'Owner cascade is Dataverse-managed.', 'Use id plus owner_logical_name.'),
    ('contact_currency', 'lookup', 'contact', 'transactioncurrencyid', ARRAY['transactioncurrency'], 'transactioncurrencyid', 'contacts', 'transaction_currency_id', NULL, false, 'Restrict/delete behavior comes from metadata.', 'Currency for money fields.'),
    ('customeraddress_parent', 'polymorphic', 'customeraddress', 'parentid', ARRAY['account','contact'], 'id', 'customer_addresses', 'parent_id', 'parent_logical_name', true, 'Do not treat address snapshots as strict account/contact FKs.', 'Parent table identified by parent_logical_name.'),
    ('lead_customer', 'customer', 'lead', 'customerid', ARRAY['account','contact'], 'id', 'leads', 'customer_id', 'customer_logical_name', true, 'Customer lookup cascade is Dataverse-managed.', 'Existing customer reference.'),
    ('lead_parent_account', 'lookup', 'lead', 'parentaccountid', ARRAY['account'], 'accountid', 'leads', 'parent_account_id', NULL, false, 'Query metadata.', 'Related account.'),
    ('lead_parent_contact', 'lookup', 'lead', 'parentcontactid', ARRAY['contact'], 'contactid', 'leads', 'parent_contact_id', NULL, false, 'Query metadata.', 'Related contact.'),
    ('lead_qualifying_opportunity', 'lookup', 'lead', 'qualifyingopportunityid', ARRAY['opportunity'], 'opportunityid', 'leads', 'qualifying_opportunity_id', NULL, false, 'Query metadata.', 'Opportunity created during qualification.'),
    ('lead_owner', 'owner', 'lead', 'ownerid', ARRAY['systemuser','team'], 'id', 'leads', 'owner_id', 'owner_logical_name', true, 'Owner cascade is Dataverse-managed.', 'Use id plus owner_logical_name.'),
    ('lead_currency', 'lookup', 'lead', 'transactioncurrencyid', ARRAY['transactioncurrency'], 'transactioncurrencyid', 'leads', 'transaction_currency_id', NULL, false, 'Query metadata.', 'Currency for lead money fields.'),
    ('opportunity_customer', 'customer', 'opportunity', 'customerid', ARRAY['account','contact'], 'id', 'opportunities', 'customer_id', 'customer_logical_name', true, 'Customer lookup cascade is Dataverse-managed.', 'Potential customer reference.'),
    ('opportunity_parent_account', 'lookup', 'opportunity', 'parentaccountid', ARRAY['account'], 'accountid', 'opportunities', 'parent_account_id', NULL, false, 'Query metadata.', 'Related account.'),
    ('opportunity_parent_contact', 'lookup', 'opportunity', 'parentcontactid', ARRAY['contact'], 'contactid', 'opportunities', 'parent_contact_id', NULL, false, 'Query metadata.', 'Related contact.'),
    ('opportunity_originating_lead', 'lookup', 'opportunity', 'originatingleadid', ARRAY['lead'], 'leadid', 'opportunities', 'originating_lead_id', NULL, false, 'Query metadata.', 'Source lead.'),
    ('opportunity_price_level', 'lookup', 'opportunity', 'pricelevelid', ARRAY['pricelevel'], 'pricelevelid', 'opportunities', 'price_level_id', NULL, false, 'Query metadata.', 'Price list.'),
    ('opportunity_owner', 'owner', 'opportunity', 'ownerid', ARRAY['systemuser','team'], 'id', 'opportunities', 'owner_id', 'owner_logical_name', true, 'Owner cascade is Dataverse-managed.', 'Use id plus owner_logical_name.'),
    ('opportunity_currency', 'lookup', 'opportunity', 'transactioncurrencyid', ARRAY['transactioncurrency'], 'transactioncurrencyid', 'opportunities', 'transaction_currency_id', NULL, false, 'Query metadata.', 'Currency for opportunity money fields.'),
    ('opportunityproduct_opportunity', 'lookup', 'opportunityproduct', 'opportunityid', ARRAY['opportunity'], 'opportunityid', 'opportunity_products', 'opportunity_id', NULL, false, 'Usually cascades from opportunity to lines.', 'Parent opportunity.'),
    ('opportunityproduct_product', 'lookup', 'opportunityproduct', 'productid', ARRAY['product'], 'productid', 'opportunity_products', 'product_id', NULL, false, 'Line can be write-in when product is null.', 'Product catalog item.'),
    ('opportunityproduct_uom', 'lookup', 'opportunityproduct', 'uomid', ARRAY['uom'], 'uomid', 'opportunity_products', 'uom_id', NULL, false, 'Query metadata.', 'Unit.'),
    ('opportunityproduct_parent_bundle', 'lookup', 'opportunityproduct', 'parentbundleidref', ARRAY['opportunityproduct'], 'opportunityproductid', 'opportunity_products', 'parent_bundle_id', NULL, false, 'Query metadata.', 'Bundle parent line.'),
    ('quote_customer', 'customer', 'quote', 'customerid', ARRAY['account','contact'], 'id', 'quotes', 'customer_id', 'customer_logical_name', true, 'Customer lookup cascade is Dataverse-managed.', 'Quote customer.'),
    ('quote_opportunity', 'lookup', 'quote', 'opportunityid', ARRAY['opportunity'], 'opportunityid', 'quotes', 'opportunity_id', NULL, false, 'Query metadata.', 'Source opportunity.'),
    ('quote_price_level', 'lookup', 'quote', 'pricelevelid', ARRAY['pricelevel'], 'pricelevelid', 'quotes', 'price_level_id', NULL, false, 'Query metadata.', 'Price list.'),
    ('quote_owner', 'owner', 'quote', 'ownerid', ARRAY['systemuser','team'], 'id', 'quotes', 'owner_id', 'owner_logical_name', true, 'Owner cascade is Dataverse-managed.', 'Use id plus owner_logical_name.'),
    ('quote_currency', 'lookup', 'quote', 'transactioncurrencyid', ARRAY['transactioncurrency'], 'transactioncurrencyid', 'quotes', 'transaction_currency_id', NULL, false, 'Query metadata.', 'Currency for quote money fields.'),
    ('quotedetail_quote', 'lookup', 'quotedetail', 'quoteid', ARRAY['quote'], 'quoteid', 'quote_lines', 'quote_id', NULL, false, 'Usually cascades from quote to lines.', 'Parent quote.'),
    ('quotedetail_product', 'lookup', 'quotedetail', 'productid', ARRAY['product'], 'productid', 'quote_lines', 'product_id', NULL, false, 'Line can be write-in when product is null.', 'Product catalog item.'),
    ('quotedetail_uom', 'lookup', 'quotedetail', 'uomid', ARRAY['uom'], 'uomid', 'quote_lines', 'uom_id', NULL, false, 'Query metadata.', 'Unit.'),
    ('quotedetail_sales_rep', 'lookup', 'quotedetail', 'salesrepid', ARRAY['systemuser'], 'systemuserid', 'quote_lines', 'sales_rep_id', NULL, false, 'Query metadata.', 'Sales rep.'),
    ('salesorder_customer', 'customer', 'salesorder', 'customerid', ARRAY['account','contact'], 'id', 'sales_orders', 'customer_id', 'customer_logical_name', true, 'Customer lookup cascade is Dataverse-managed.', 'Order customer.'),
    ('salesorder_quote', 'lookup', 'salesorder', 'quoteid', ARRAY['quote'], 'quoteid', 'sales_orders', 'quote_id', NULL, false, 'Query metadata.', 'Source quote.'),
    ('salesorder_opportunity', 'lookup', 'salesorder', 'opportunityid', ARRAY['opportunity'], 'opportunityid', 'sales_orders', 'opportunity_id', NULL, false, 'Query metadata.', 'Related opportunity.'),
    ('salesorder_price_level', 'lookup', 'salesorder', 'pricelevelid', ARRAY['pricelevel'], 'pricelevelid', 'sales_orders', 'price_level_id', NULL, false, 'Query metadata.', 'Price list.'),
    ('salesorder_owner', 'owner', 'salesorder', 'ownerid', ARRAY['systemuser','team'], 'id', 'sales_orders', 'owner_id', 'owner_logical_name', true, 'Owner cascade is Dataverse-managed.', 'Use id plus owner_logical_name.'),
    ('salesorder_currency', 'lookup', 'salesorder', 'transactioncurrencyid', ARRAY['transactioncurrency'], 'transactioncurrencyid', 'sales_orders', 'transaction_currency_id', NULL, false, 'Query metadata.', 'Currency for order money fields.'),
    ('salesorderdetail_order', 'lookup', 'salesorderdetail', 'salesorderid', ARRAY['salesorder'], 'salesorderid', 'sales_order_lines', 'sales_order_id', NULL, false, 'Usually cascades from order to lines.', 'Parent order.'),
    ('salesorderdetail_quote_line', 'lookup', 'salesorderdetail', 'quotedetailid', ARRAY['quotedetail'], 'quotedetailid', 'sales_order_lines', 'quote_line_id', NULL, false, 'Query metadata.', 'Source quote line.'),
    ('invoice_customer', 'customer', 'invoice', 'customerid', ARRAY['account','contact'], 'id', 'invoices', 'customer_id', 'customer_logical_name', true, 'Customer lookup cascade is Dataverse-managed.', 'Invoice customer.'),
    ('invoice_sales_order', 'lookup', 'invoice', 'salesorderid', ARRAY['salesorder'], 'salesorderid', 'invoices', 'sales_order_id', NULL, false, 'Query metadata.', 'Source order.'),
    ('invoice_opportunity', 'lookup', 'invoice', 'opportunityid', ARRAY['opportunity'], 'opportunityid', 'invoices', 'opportunity_id', NULL, false, 'Query metadata.', 'Related opportunity.'),
    ('invoice_price_level', 'lookup', 'invoice', 'pricelevelid', ARRAY['pricelevel'], 'pricelevelid', 'invoices', 'price_level_id', NULL, false, 'Query metadata.', 'Price list.'),
    ('invoice_owner', 'owner', 'invoice', 'ownerid', ARRAY['systemuser','team'], 'id', 'invoices', 'owner_id', 'owner_logical_name', true, 'Owner cascade is Dataverse-managed.', 'Use id plus owner_logical_name.'),
    ('invoice_currency', 'lookup', 'invoice', 'transactioncurrencyid', ARRAY['transactioncurrency'], 'transactioncurrencyid', 'invoices', 'transaction_currency_id', NULL, false, 'Query metadata.', 'Currency for invoice money fields.'),
    ('invoicedetail_invoice', 'lookup', 'invoicedetail', 'invoiceid', ARRAY['invoice'], 'invoiceid', 'invoice_lines', 'invoice_id', NULL, false, 'Usually cascades from invoice to lines.', 'Parent invoice.'),
    ('invoicedetail_order_line', 'lookup', 'invoicedetail', 'salesorderdetailid', ARRAY['salesorderdetail'], 'salesorderdetailid', 'invoice_lines', 'sales_order_line_id', NULL, false, 'Query metadata.', 'Source order line.'),
    ('product_default_uom', 'lookup', 'product', 'defaultuomid', ARRAY['uom'], 'uomid', 'products', 'default_uom_id', NULL, false, 'Query metadata.', 'Default unit.'),
    ('product_default_unit_group', 'lookup', 'product', 'defaultuomscheduleid', ARRAY['uomschedule'], 'uomscheduleid', 'products', 'default_unit_group_id', NULL, false, 'Query metadata.', 'Default unit group.'),
    ('product_parent_product', 'lookup', 'product', 'parentproductid', ARRAY['product'], 'productid', 'products', 'parent_product_id', NULL, false, 'Query metadata.', 'Product family or bundle parent.'),
    ('product_price_level', 'lookup', 'product', 'pricelevelid', ARRAY['pricelevel'], 'pricelevelid', 'products', 'price_level_id', NULL, false, 'Query metadata.', 'Default price list.'),
    ('productpricelevel_product', 'lookup', 'productpricelevel', 'productid', ARRAY['product'], 'productid', 'product_price_levels', 'product_id', NULL, false, 'Query metadata.', 'Product side.'),
    ('productpricelevel_price_level', 'lookup', 'productpricelevel', 'pricelevelid', ARRAY['pricelevel'], 'pricelevelid', 'product_price_levels', 'price_level_id', NULL, false, 'Query metadata.', 'Price list side.'),
    ('productpricelevel_uom', 'lookup', 'productpricelevel', 'uomid', ARRAY['uom'], 'uomid', 'product_price_levels', 'uom_id', NULL, false, 'Query metadata.', 'Unit side.'),
    ('uom_base_uom', 'lookup', 'uom', 'baseuom', ARRAY['uom'], 'uomid', 'units_of_measure', 'base_uom_id', NULL, false, 'Query metadata.', 'Base unit.'),
    ('uom_unit_group', 'lookup', 'uom', 'uomscheduleid', ARRAY['uomschedule'], 'uomscheduleid', 'units_of_measure', 'unit_group_id', NULL, false, 'Query metadata.', 'Unit group.'),
    ('opportunitycompetitors_opportunity', 'many_to_many', 'opportunitycompetitors', 'opportunityid', ARRAY['opportunity'], 'opportunityid', 'opportunity_competitors', 'opportunity_id', NULL, false, 'Intersect row should delete with either side.', 'Opportunity side of competitor association.'),
    ('opportunitycompetitors_competitor', 'many_to_many', 'opportunitycompetitors', 'competitorid', ARRAY['competitor'], 'competitorid', 'opportunity_competitors', 'competitor_id', NULL, false, 'Intersect row should delete with either side.', 'Competitor side of association.'),
    ('activitypointer_regarding', 'regarding', 'activitypointer', 'regardingobjectid', ARRAY['account','contact','lead','opportunity','quote','salesorder','invoice','product','competitor'], 'id', 'activities', 'regarding_object_id', 'regarding_object_logical_name', true, 'Regarding cascade varies by target.', 'Do not model as one FK.'),
    ('activityparty_party', 'partylist', 'activityparty', 'partyid', ARRAY['account','contact','lead','systemuser','team'], 'id', 'activity_parties', 'party_id', 'party_logical_name', true, 'PartyList participant, not scalar FK.', 'Use for email to/from, phone parties, appointments.'),
    ('annotation_object', 'polymorphic', 'annotation', 'objectid', ARRAY['account','contact','lead','opportunity','quote','salesorder','invoice','product','competitor'], 'id', 'annotations', 'object_id', 'object_logical_name', true, 'Note-enabled target cascade varies by metadata.', 'Notes and attachments parent.'),
    ('connection_record_one', 'polymorphic', 'connection', 'record1id', ARRAY['account','contact','lead','opportunity','quote','salesorder','invoice','product','competitor'], 'id', 'connections', 'record_one_id', 'record_one_logical_name', true, 'Connection cascade varies by target.', 'Connected-from side.'),
    ('connection_record_two', 'polymorphic', 'connection', 'record2id', ARRAY['account','contact','lead','opportunity','quote','salesorder','invoice','product','competitor'], 'id', 'connections', 'record_two_id', 'record_two_logical_name', true, 'Connection cascade varies by target.', 'Connected-to side.')
ON CONFLICT (schema_name) DO UPDATE SET
    relationship_type = EXCLUDED.relationship_type,
    referencing_logical_name = EXCLUDED.referencing_logical_name,
    referencing_attribute = EXCLUDED.referencing_attribute,
    referenced_logical_names = EXCLUDED.referenced_logical_names,
    referenced_attribute = EXCLUDED.referenced_attribute,
    local_table_name = EXCLUDED.local_table_name,
    local_column_name = EXCLUDED.local_column_name,
    local_type_column_name = EXCLUDED.local_type_column_name,
    is_polymorphic = EXCLUDED.is_polymorphic,
    cascade_notes = EXCLUDED.cascade_notes,
    modeling_notes = EXCLUDED.modeling_notes,
    updated_at = now();

CREATE OR REPLACE VIEW dataverse_relationship_matrix_view AS
SELECT
    schema_name,
    relationship_type,
    referencing_logical_name,
    referencing_attribute,
    referenced_logical_names,
    referenced_attribute,
    local_table_name,
    local_column_name,
    local_type_column_name,
    is_polymorphic,
    modeling_notes
FROM dataverse_relationship_definitions
ORDER BY referencing_logical_name, referencing_attribute, schema_name;

CREATE OR REPLACE VIEW customer_relationship_summary_view AS
SELECT
    'account'::TEXT AS source_type,
    a.id AS source_id,
    a.account_name AS source_name,
    'primarycontactid'::TEXT AS relationship_attribute,
    'contact'::TEXT AS target_type,
    c.id AS target_id,
    c.full_name AS target_name
FROM accounts a
JOIN contacts c ON c.id = a.primary_contact_id
WHERE a.deleted_at IS NULL
  AND c.deleted_at IS NULL
UNION ALL
SELECT
    'contact',
    c.id,
    c.full_name,
    'parentcustomerid',
    c.parent_customer_logical_name,
    c.parent_customer_id,
    COALESCE(a.account_name, parent_contact.full_name)
FROM contacts c
LEFT JOIN accounts a
    ON c.parent_customer_logical_name = 'account'
   AND a.id = c.parent_customer_id
LEFT JOIN contacts parent_contact
    ON c.parent_customer_logical_name = 'contact'
   AND parent_contact.id = c.parent_customer_id
WHERE c.deleted_at IS NULL
  AND c.parent_customer_id IS NOT NULL
UNION ALL
SELECT
    'opportunity',
    o.id,
    o.opportunity_name,
    'customerid',
    o.customer_logical_name,
    o.customer_id,
    COALESCE(a.account_name, c.full_name)
FROM opportunities o
LEFT JOIN accounts a
    ON o.customer_logical_name = 'account'
   AND a.id = o.customer_id
LEFT JOIN contacts c
    ON o.customer_logical_name = 'contact'
   AND c.id = o.customer_id
WHERE o.deleted_at IS NULL
  AND o.customer_id IS NOT NULL
UNION ALL
SELECT
    'opportunity',
    oc.opportunity_id,
    o.opportunity_name,
    COALESCE(oc.relationship_role, 'opportunitycontact'),
    'contact',
    oc.contact_id,
    c.full_name
FROM opportunity_contacts oc
JOIN opportunities o ON o.id = oc.opportunity_id
JOIN contacts c ON c.id = oc.contact_id
WHERE oc.deleted_at IS NULL;

CREATE OR REPLACE VIEW sales_document_chain_view AS
SELECT
    q.id AS quote_id,
    q.name AS quote_name,
    q.quote_number,
    so.id AS sales_order_id,
    so.name AS sales_order_name,
    so.order_number,
    inv.id AS invoice_id,
    inv.name AS invoice_name,
    inv.invoice_number,
    COALESCE(inv.customer_logical_name, so.customer_logical_name, q.customer_logical_name) AS customer_logical_name,
    COALESCE(inv.customer_id, so.customer_id, q.customer_id) AS customer_id,
    COALESCE(inv.opportunity_id, so.opportunity_id, q.opportunity_id) AS opportunity_id,
    COALESCE(inv.total_amount, so.total_amount, q.total_amount) AS latest_total_amount
FROM quotes q
LEFT JOIN sales_orders so ON so.quote_id = q.id AND so.deleted_at IS NULL
LEFT JOIN invoices inv ON inv.sales_order_id = so.id AND inv.deleted_at IS NULL
WHERE q.deleted_at IS NULL;
