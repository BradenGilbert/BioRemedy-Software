CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID,
    task_id UUID,
    issue_id UUID,

    file_type TEXT,

    url TEXT,

    metadata JSONB,

    created_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_files_project_id ON files(project_id);
CREATE INDEX idx_files_task_id ON files(task_id);
CREATE INDEX idx_files_issue_id ON files(issue_id);
CREATE INDEX idx_files_type ON files(file_type);
CREATE INDEX idx_files_created_at ON files(created_at);
CREATE INDEX idx_files_activity_time ON files(created_at DESC);
CREATE INDEX idx_files_deleted_at ON files(deleted_at);
