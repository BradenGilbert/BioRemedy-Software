CREATE TABLE job_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    facility_id UUID REFERENCES facilities(id),
    facility_node_id UUID REFERENCES facility_nodes(id),

    name TEXT,
    site_type TEXT NOT NULL,

    description TEXT,

    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,

    linear_reference TEXT,

    is_temporary BOOLEAN DEFAULT true,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_job_sites_account_id ON job_sites(account_id);
CREATE INDEX idx_job_sites_facility_id ON job_sites(facility_id);
CREATE INDEX idx_job_sites_node_id ON job_sites(facility_node_id);
CREATE INDEX idx_job_sites_type ON job_sites(site_type);
CREATE INDEX idx_job_sites_geo ON job_sites(latitude, longitude);
CREATE INDEX idx_job_sites_deleted_at ON job_sites(deleted_at);
