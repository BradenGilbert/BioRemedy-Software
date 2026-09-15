CREATE TABLE issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID REFERENCES projects(id),
    task_id UUID REFERENCES tasks(id),

    issue_type TEXT,
    severity TEXT,

    title TEXT,
    description TEXT,

    status TEXT DEFAULT 'open',

    created_by UUID,
    assigned_to UUID,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_issues_project_id ON issues(project_id);
CREATE INDEX idx_issues_task_id ON issues(task_id);
CREATE INDEX idx_issues_status ON issues(status);
CREATE INDEX idx_issues_severity ON issues(severity);
CREATE INDEX idx_issues_assigned_to ON issues(assigned_to);
CREATE INDEX idx_issues_created_at ON issues(created_at);
CREATE INDEX idx_issues_deleted_at ON issues(deleted_at);
