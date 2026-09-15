CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,

    activity_type TEXT NOT NULL CHECK (activity_type IN ('Meeting', 'Call', 'Email', 'Task')),
    subject TEXT NOT NULL,
    body TEXT,
    direction TEXT,
    channel TEXT,
    status TEXT DEFAULT 'Completed',
    priority TEXT,

    activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    completed_at TIMESTAMP,

    owner_name TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_activities_account_id ON activities(account_id);
CREATE INDEX idx_activities_contact_id ON activities(contact_id);
CREATE INDEX idx_activities_opportunity_id ON activities(opportunity_id);
CREATE INDEX idx_activities_type ON activities(activity_type);
CREATE INDEX idx_activities_status ON activities(status);
CREATE INDEX idx_activities_activity_date ON activities(activity_date);
CREATE INDEX idx_activities_due_date ON activities(due_date);
CREATE INDEX idx_activities_deleted_at ON activities(deleted_at);

CREATE OR REPLACE VIEW activity_timeline_view AS
SELECT
    act.id,
    act.activity_type,
    act.subject,
    act.body,
    act.status,
    act.activity_date,
    act.due_date,
    act.owner_name,
    acct.account_name,
    c.full_name AS contact_name,
    o.opportunity_name
FROM activities act
LEFT JOIN accounts acct ON acct.id = act.account_id
LEFT JOIN contacts c ON c.id = act.contact_id
LEFT JOIN opportunities o ON o.id = act.opportunity_id
WHERE act.deleted_at IS NULL;
