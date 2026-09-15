CREATE TABLE facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    facility_type TEXT NOT NULL,

    address TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,

    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,

    notes TEXT,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_facilities_account_id ON facilities(account_id);
CREATE INDEX idx_facilities_type ON facilities(facility_type);
CREATE INDEX idx_facilities_location ON facilities(latitude, longitude);
CREATE INDEX idx_facilities_deleted_at ON facilities(deleted_at);
