CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rpa_app_user (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(200) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'VIEWER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_app_user_username CHECK (
        username = LOWER(username) AND username ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
    ),
    CONSTRAINT chk_app_user_role CHECK (
        role IN ('ADMIN', 'OPERATOR', 'VIEWER')
    )
);

CREATE TABLE IF NOT EXISTS rpa_user_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES rpa_app_user(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent VARCHAR(500),
    ip_address VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rpa_robot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    robot_code VARCHAR(100) NOT NULL UNIQUE,
    robot_name VARCHAR(255) NOT NULL,
    robot_type VARCHAR(30) NOT NULL DEFAULT 'CLOUD_DESKTOP',
    power_automate_environment_id VARCHAR(200),
    cloud_flow_id VARCHAR(200),
    cloud_flow_name VARCHAR(255),
    cloud_trigger_name VARCHAR(150),
    desktop_flow_id VARCHAR(200),
    desktop_flow_name VARCHAR(255),
    power_automate_url TEXT,
    account_name VARCHAR(150),
    machine_name VARCHAR(150),
    machine_ip VARCHAR(100),
    anydesk_id VARCHAR(100),
    max_expected_run_minutes INTEGER NOT NULL DEFAULT 60,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_robot_type CHECK (
        robot_type IN ('CLOUD_DESKTOP', 'CLOUD_ONLY', 'DESKTOP_ONLY')
    ),
    CONSTRAINT chk_max_expected_run_minutes CHECK (
        max_expected_run_minutes > 0
    )
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'rpa_robot'
          AND column_name = 'account_label'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'rpa_robot'
              AND column_name = 'account_name'
        ) THEN
            EXECUTE 'ALTER TABLE rpa_robot RENAME COLUMN account_label TO account_name';
        ELSE
            EXECUTE 'UPDATE rpa_robot SET account_name = COALESCE(account_name, account_label)';
            EXECUTE 'ALTER TABLE rpa_robot DROP COLUMN account_label';
        END IF;
    END IF;

    EXECUTE 'ALTER TABLE rpa_robot DROP COLUMN IF EXISTS anydesk_alias';
END;
$$;

CREATE TABLE IF NOT EXISTS rpa_robot_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    robot_id UUID NOT NULL REFERENCES rpa_robot(id),
    status VARCHAR(30) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    cloud_flow_run_id TEXT,
    desktop_flow_session_id TEXT,
    machine_name VARCHAR(150),
    error_code VARCHAR(200),
    error_message TEXT,
    error_step VARCHAR(255),
    retry_count INTEGER NOT NULL DEFAULT 0,
    retry_of_run_id UUID REFERENCES rpa_robot_run(id),
    input_reference TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_robot_run_status CHECK (
        status IN ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT', 'UNKNOWN')
    ),
    CONSTRAINT chk_retry_count CHECK (retry_count >= 0),
    CONSTRAINT chk_duration_seconds CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);

CREATE TABLE IF NOT EXISTS rpa_daily_run_counter (
    run_date DATE PRIMARY KEY,
    last_value INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_daily_run_counter_value CHECK (last_value > 0)
);

CREATE TABLE IF NOT EXISTS rpa_run_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    robot_run_id UUID NOT NULL REFERENCES rpa_robot_run(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    step_name VARCHAR(255),
    message TEXT,
    event_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_event_type CHECK (event_type IN ('INFO', 'WARNING', 'ERROR'))
);

CREATE TABLE IF NOT EXISTS rpa_control_action (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    robot_id UUID NOT NULL REFERENCES rpa_robot(id),
    robot_run_id UUID REFERENCES rpa_robot_run(id),
    action_type VARCHAR(30) NOT NULL,
    requested_by VARCHAR(255),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    new_cloud_flow_run_id TEXT,
    new_desktop_session_id TEXT,
    error_message TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_action_type CHECK (
        action_type IN ('RETRY', 'RESUBMIT', 'RUN_NOW', 'CANCEL')
    ),
    CONSTRAINT chk_action_status CHECK (
        status IN ('REQUESTED', 'PROCESSING', 'SUCCESS', 'FAILED')
    )
);

CREATE INDEX IF NOT EXISTS idx_rpa_robot_active
    ON rpa_robot(is_active);
CREATE INDEX IF NOT EXISTS idx_rpa_app_user_active
    ON rpa_app_user(is_active);
CREATE INDEX IF NOT EXISTS idx_rpa_user_session_user
    ON rpa_user_session(user_id);
CREATE INDEX IF NOT EXISTS idx_rpa_user_session_expires
    ON rpa_user_session(expires_at);
CREATE INDEX IF NOT EXISTS idx_rpa_robot_run_robot
    ON rpa_robot_run(robot_id);
CREATE INDEX IF NOT EXISTS idx_rpa_robot_run_status
    ON rpa_robot_run(status);
CREATE INDEX IF NOT EXISTS idx_rpa_robot_run_started
    ON rpa_robot_run(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rpa_robot_run_robot_started
    ON rpa_robot_run(robot_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rpa_run_event_run
    ON rpa_run_event(robot_run_id);
CREATE INDEX IF NOT EXISTS idx_rpa_control_action_robot
    ON rpa_control_action(robot_id);
CREATE INDEX IF NOT EXISTS idx_rpa_control_action_run
    ON rpa_control_action(robot_run_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rpa_robot_updated_at ON rpa_robot;
CREATE TRIGGER trg_rpa_robot_updated_at
BEFORE UPDATE ON rpa_robot
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rpa_app_user_updated_at ON rpa_app_user;
CREATE TRIGGER trg_rpa_app_user_updated_at
BEFORE UPDATE ON rpa_app_user
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rpa_robot_run_updated_at ON rpa_robot_run;
CREATE TRIGGER trg_rpa_robot_run_updated_at
BEFORE UPDATE ON rpa_robot_run
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
