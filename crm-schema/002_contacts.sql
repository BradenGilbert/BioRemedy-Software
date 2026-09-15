CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_unique_identifier UUID NOT NULL DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,

    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    job_title TEXT,
    account_role TEXT,
    relationship_role TEXT,
    lifecycle_stage TEXT,
    lead_status TEXT,
    owner_name TEXT,
    hubspot_owner_id TEXT,
    originating_lead_id UUID,

    email TEXT,
    email_address_two TEXT,
    email_address_three TEXT,
    business_phone TEXT,
    mobile_phone TEXT,
    phone TEXT,
    fax TEXT,
    preferred_contact_method TEXT,
    do_not_allow_emails BOOLEAN DEFAULT false,
    do_not_allow_phone_calls BOOLEAN DEFAULT false,
    do_not_allow_mail BOOLEAN DEFAULT false,
    do_not_allow_faxes BOOLEAN DEFAULT false,

    address_one_type TEXT,
    address_one_street_one TEXT,
    address_one_street_two TEXT,
    address_one_street_three TEXT,
    address_one_city TEXT,
    address_one_state TEXT,
    address_one_country TEXT,
    address_one_zip_code TEXT,
    address_one_telephone_one TEXT,
    address_one_telephone_two TEXT,
    address_one_telephone_three TEXT,
    address_one_ups_zone TEXT,
    address_one_utc_offset TEXT,

    address_two_type TEXT,
    address_two_street_one TEXT,
    address_two_street_two TEXT,
    address_two_street_three TEXT,
    address_two_city TEXT,
    address_two_state TEXT,
    address_two_country TEXT,
    address_two_zip_code TEXT,
    address_two_telephone_one TEXT,
    address_two_telephone_two TEXT,
    address_two_telephone_three TEXT,
    address_two_fax TEXT,

    last_contacted TIMESTAMP,
    last_activity_date TIMESTAMP,
    next_activity_date TIMESTAMP,
    number_of_sales_activities INTEGER DEFAULT 0,
    number_of_times_contacted INTEGER DEFAULT 0,
    record_source TEXT,
    notes TEXT,

    created_by TEXT,
    created_on TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_contacts_account_id ON contacts(account_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_name ON contacts(last_name, first_name);
CREATE INDEX idx_contacts_role ON contacts(relationship_role);
CREATE INDEX idx_contacts_lifecycle ON contacts(lifecycle_stage);
CREATE INDEX idx_contacts_deleted_at ON contacts(deleted_at);
CREATE INDEX idx_contacts_search
ON contacts
USING GIN (
    to_tsvector(
        'english',
        coalesce(full_name, '') || ' ' ||
        coalesce(job_title, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(phone, '') || ' ' ||
        coalesce(mobile_phone, '') || ' ' ||
        coalesce(relationship_role, '')
    )
);

CREATE OR REPLACE VIEW sales_contact_view AS
SELECT
    c.id,
    c.full_name,
    c.job_title,
    c.email,
    c.phone,
    c.mobile_phone,
    c.relationship_role,
    c.preferred_contact_method,
    c.lead_status,
    a.account_name
FROM contacts c
LEFT JOIN accounts a ON a.id = c.account_id
WHERE c.deleted_at IS NULL;

CREATE OR REPLACE VIEW contact_outreach_view AS
SELECT
    id,
    full_name,
    email,
    business_phone,
    mobile_phone,
    preferred_contact_method,
    last_contacted,
    next_activity_date,
    do_not_allow_emails,
    do_not_allow_phone_calls
FROM contacts
WHERE deleted_at IS NULL;
