BEGIN;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    chat_id BIGINT UNIQUE NOT NULL,
    fiat VARCHAR(10) NOT NULL DEFAULT 'USD',
    timezone VARCHAR(20) NOT NULL DEFAULT 'UTC',
    morning_summary BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_start VARCHAR(5) NOT NULL DEFAULT '23:00',
    quiet_hours_end VARCHAR(5) NOT NULL DEFAULT '07:00',
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_immediate BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tokens (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (symbol, address)
);

CREATE TABLE watches (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('price_below', 'price_above', 'percent_move')),
    threshold DECIMAL(20, 8),
    percent_threshold DECIMAL(10, 4),
    is_recurring BOOLEAN NOT NULL DEFAULT TRUE,
    is_one_shot BOOLEAN NOT NULL DEFAULT FALSE,
    last_triggered_at TIMESTAMPTZ,
    trigger_price DECIMAL(20, 8),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE alert_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id INTEGER NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    rule_type VARCHAR(20) NOT NULL,
    trigger_description TEXT NOT NULL,
    current_price DECIMAL(20, 8) NOT NULL,
    baseline_price DECIMAL(20, 8),
    percent_change DECIMAL(10, 4),
    delivered BOOLEAN NOT NULL DEFAULT FALSE,
    delivery_timestamp TIMESTAMPTZ,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_watches_user_id ON watches(user_id);
CREATE INDEX idx_watches_token_id ON watches(token_id);
CREATE INDEX idx_watches_user_token ON watches(user_id, token_id);
CREATE INDEX idx_alert_history_user_id ON alert_history(user_id);
CREATE INDEX idx_alert_history_token_id ON alert_history(token_id);
CREATE INDEX idx_alert_history_triggered_at ON alert_history(triggered_at);
CREATE INDEX idx_alert_history_user_triggered ON alert_history(user_id, triggered_at);
CREATE INDEX idx_admin_events_event_type ON admin_events(event_type);
CREATE INDEX idx_admin_events_created_at ON admin_events(created_at);

COMMIT;
