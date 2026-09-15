CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_unique_identifier UUID NOT NULL DEFAULT gen_random_uuid(),
    account_number TEXT UNIQUE,
    account_name TEXT NOT NULL,
    account_rating TEXT,
    account_type TEXT,
    business_type TEXT,
    category TEXT,
    classification TEXT,
    customer_size TEXT,
    industry TEXT,
    number_of_employees INTEGER,
    description TEXT,

    website TEXT,
    email TEXT,
    email_address_two TEXT,
    email_address_three TEXT,
    main_phone_number TEXT,
    fax_number TEXT,
    time_zone TEXT,

    address_one_type TEXT,
    address_one_street_one TEXT,
    address_one_street_two TEXT,
    address_one_street_three TEXT,
    address_one_city TEXT,
    address_one_state TEXT,
    address_one_county TEXT,
    address_one_country TEXT,
    address_one_zip_code TEXT,
    address_one_post_office_box TEXT,
    address_one_latitude NUMERIC(10,7),
    address_one_longitude NUMERIC(10,7),
    address_one_primary_contact TEXT,
    address_one_telephone_one TEXT,
    address_one_telephone_two TEXT,
    address_one_phone_number TEXT,
    address_one_fax TEXT,
    address_one_freight_terms TEXT,
    address_one_shipping_method TEXT,
    address_one_ups_zone TEXT,
    address_one_utc_offset TEXT,
    address_one_unique_identifier UUID DEFAULT gen_random_uuid(),

    address_two_type TEXT,
    address_two_name TEXT,
    address_two_street_one TEXT,
    address_two_street_two TEXT,
    address_two_street_three TEXT,
    address_two_city TEXT,
    address_two_region TEXT,
    address_two_state TEXT,
    address_two_country TEXT,
    address_two_zip_code TEXT,
    address_two_primary_contact TEXT,
    address_two_telephone_one TEXT,
    address_two_telephone_two TEXT,
    address_two_telephone_three TEXT,
    address_two_fax TEXT,

    billing_address TEXT,
    billing_address_name TEXT,
    billing_address_street TEXT,
    billing_address_street_two TEXT,
    billing_address_street_three TEXT,
    billing_address_suite_number TEXT,
    billing_address_state TEXT,
    billing_address_country TEXT,
    billing_address_zip_code TEXT,
    billing_interval TEXT,
    billing_type TEXT,
    annual_revenue NUMERIC(14,2),
    annual_revenue_base NUMERIC(14,2),
    available_credit NUMERIC(14,2),
    credit_hold BOOLEAN DEFAULT false,
    currency TEXT DEFAULT 'USD',
    average_time_to_close_opportunity INTEGER,

    do_not_allow_bulk_email BOOLEAN DEFAULT false,
    do_not_allow_bulk_mail BOOLEAN DEFAULT false,
    do_not_allow_emails BOOLEAN DEFAULT false,
    do_not_allow_faxes BOOLEAN DEFAULT false,
    do_not_allow_mail BOOLEAN DEFAULT false,
    do_not_allow_phone_calls BOOLEAN DEFAULT false,

    owner_name TEXT,
    created_by TEXT,
    created_on TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_accounts_account_name ON accounts(account_name);
CREATE INDEX idx_accounts_number ON accounts(account_number);
CREATE INDEX idx_accounts_type ON accounts(account_type);
CREATE INDEX idx_accounts_rating ON accounts(account_rating);
CREATE INDEX idx_accounts_city ON accounts(address_one_city);
CREATE INDEX idx_accounts_credit_hold ON accounts(credit_hold);
CREATE INDEX idx_accounts_deleted_at ON accounts(deleted_at);
CREATE INDEX idx_accounts_search
ON accounts
USING GIN (
    to_tsvector(
        'english',
        coalesce(account_name, '') || ' ' ||
        coalesce(account_number, '') || ' ' ||
        coalesce(account_type, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(main_phone_number, '') || ' ' ||
        coalesce(address_one_city, '') || ' ' ||
        coalesce(website, '')
    )
);

CREATE OR REPLACE VIEW sales_account_view AS
SELECT
    id,
    account_name,
    account_number,
    account_rating,
    account_type,
    address_one_primary_contact AS primary_contact,
    main_phone_number,
    email,
    website,
    address_one_city AS city,
    owner_name,
    created_on,
    updated_at
FROM accounts
WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW account_billing_signal_view AS
SELECT
    id,
    account_name,
    account_number,
    annual_revenue,
    available_credit,
    credit_hold,
    billing_type,
    billing_interval,
    currency
FROM accounts
WHERE deleted_at IS NULL;
