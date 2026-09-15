CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

    name TEXT,
    status TEXT DEFAULT 'pending',

    sequence INT,

    start_date TIMESTAMP,
    end_date TIMESTAMP,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_work_orders_project_id ON work_orders(project_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_work_orders_sequence ON work_orders(sequence);
CREATE INDEX idx_work_orders_deleted_at ON work_orders(deleted_at);
