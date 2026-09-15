CREATE TABLE facility_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,

    parent_id UUID REFERENCES facility_nodes(id),

    name TEXT NOT NULL,
    node_type TEXT,

    description TEXT,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_facility_nodes_facility_id ON facility_nodes(facility_id);
CREATE INDEX idx_facility_nodes_parent_id ON facility_nodes(parent_id);
CREATE INDEX idx_facility_nodes_deleted_at ON facility_nodes(deleted_at);
