CREATE TABLE equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT,
    type TEXT,

    serial_number TEXT,

    status TEXT,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_equipment_type ON equipment(type);
CREATE INDEX idx_equipment_status ON equipment(status);
CREATE INDEX idx_equipment_serial ON equipment(serial_number);
CREATE INDEX idx_equipment_deleted_at ON equipment(deleted_at);
