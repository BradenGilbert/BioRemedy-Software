CREATE TABLE crews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT,
    description TEXT,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_crews_name ON crews(name);
CREATE INDEX idx_crews_deleted_at ON crews(deleted_at);

CREATE TABLE crew_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    crew_id UUID REFERENCES crews(id) ON DELETE CASCADE,
    user_id UUID,

    role TEXT,

    created_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_crew_members_crew_id ON crew_members(crew_id);
CREATE INDEX idx_crew_members_user_id ON crew_members(user_id);
CREATE INDEX idx_crew_members_deleted_at ON crew_members(deleted_at);
