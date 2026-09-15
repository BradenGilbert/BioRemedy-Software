CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    facility_id UUID REFERENCES facilities(id),
    job_site_id UUID REFERENCES job_sites(id),

    name TEXT NOT NULL,
    project_type TEXT,

    status TEXT DEFAULT 'draft',
    priority TEXT DEFAULT 'normal',

    sales_rep_id UUID,
    project_manager_id UUID,

    estimated_value NUMERIC(12,2),

    start_date DATE,
    end_date DATE,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_projects_account_id ON projects(account_id);
CREATE INDEX idx_projects_facility_id ON projects(facility_id);
CREATE INDEX idx_projects_job_site_id ON projects(job_site_id);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_type ON projects(project_type);

CREATE INDEX idx_projects_sales_rep ON projects(sales_rep_id);
CREATE INDEX idx_projects_pm ON projects(project_manager_id);

CREATE INDEX idx_projects_created_at ON projects(created_at);
CREATE INDEX idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX idx_projects_search
ON projects
USING GIN (
    to_tsvector(
        'english',
        coalesce(name, '') || ' ' || coalesce(project_type, '') || ' ' || coalesce(status, '') || ' ' || coalesce(priority, '')
    )
);
