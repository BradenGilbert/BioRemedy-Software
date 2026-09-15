CREATE TABLE opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_unique_identifier UUID NOT NULL DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

    opportunity_name TEXT NOT NULL,
    owner_name TEXT,
    hubspot_owner_id TEXT,
    deal_type TEXT,
    service_type TEXT,
    source_campaign TEXT,
    originating_lead_id UUID,

    pipeline TEXT,
    deal_stage TEXT,
    status TEXT,
    forecast_category TEXT,
    close_probability NUMERIC(5,2),
    priority TEXT,
    rating TEXT,
    initial_communication TEXT,
    current_situation TEXT,
    customer_need TEXT,
    proposed_solution TEXT,
    next_step TEXT,

    amount NUMERIC(14,2),
    amount_in_company_currency NUMERIC(14,2),
    estimated_value NUMERIC(14,2),
    weighted_amount NUMERIC(14,2),
    forecast_amount NUMERIC(14,2),
    annual_recurring_revenue NUMERIC(14,2),
    total_contract_value NUMERIC(14,2),
    budget_amount NUMERIC(14,2),
    not_to_exceed TEXT,
    currency TEXT DEFAULT 'USD',
    exchange_rate NUMERIC(12,6),
    is_revenue_system_calculated BOOLEAN DEFAULT false,

    estimated_close_date DATE,
    actual_close_date DATE,
    last_contacted TIMESTAMP,
    next_activity_date TIMESTAMP,
    number_of_sales_activities INTEGER DEFAULT 0,
    number_of_associated_contacts INTEGER DEFAULT 0,
    stage_age_days INTEGER DEFAULT 0,

    competitor TEXT,
    decision_maker TEXT,
    purchase_process TEXT,
    purchase_timeframe TEXT,
    quote_id UUID,
    price_list TEXT,
    record_source TEXT,
    description TEXT,

    created_by TEXT,
    created_on TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_opportunities_account_id ON opportunities(account_id);
CREATE INDEX idx_opportunities_primary_contact_id ON opportunities(primary_contact_id);
CREATE INDEX idx_opportunities_stage ON opportunities(deal_stage);
CREATE INDEX idx_opportunities_forecast_category ON opportunities(forecast_category);
CREATE INDEX idx_opportunities_estimated_close ON opportunities(estimated_close_date);
CREATE INDEX idx_opportunities_deleted_at ON opportunities(deleted_at);
CREATE INDEX idx_opportunities_search
ON opportunities
USING GIN (
    to_tsvector(
        'english',
        coalesce(opportunity_name, '') || ' ' ||
        coalesce(deal_stage, '') || ' ' ||
        coalesce(service_type, '') || ' ' ||
        coalesce(customer_need, '') || ' ' ||
        coalesce(next_step, '')
    )
);

CREATE OR REPLACE VIEW opportunity_forecast_view AS
SELECT
    o.id,
    o.opportunity_name,
    a.account_name,
    o.deal_stage,
    o.amount,
    o.weighted_amount,
    o.estimated_close_date,
    o.forecast_category,
    o.owner_name
FROM opportunities o
LEFT JOIN accounts a ON a.id = o.account_id
WHERE o.deleted_at IS NULL;

CREATE OR REPLACE VIEW opportunity_qualification_view AS
SELECT
    o.id,
    o.opportunity_name,
    a.account_name,
    c.full_name AS primary_contact,
    o.current_situation,
    o.customer_need,
    o.proposed_solution,
    o.next_step,
    o.initial_communication
FROM opportunities o
LEFT JOIN accounts a ON a.id = o.account_id
LEFT JOIN contacts c ON c.id = o.primary_contact_id
WHERE o.deleted_at IS NULL;
