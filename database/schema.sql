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

CREATE TABLE IF NOT EXISTS rpa_machine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_name VARCHAR(150) NOT NULL UNIQUE,
    machine_ip VARCHAR(100),
    anydesk_id VARCHAR(100),
    last_heartbeat_at TIMESTAMPTZ,
    heartbeat_metadata JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_machine_name_not_blank CHECK (BTRIM(machine_name) <> '')
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
    cloud_flow_url TEXT,
    desktop_flow_id VARCHAR(200),
    desktop_flow_name VARCHAR(255),
    desktop_flow_url TEXT,
    power_automate_url TEXT,
    account_name VARCHAR(150),
    machine_id UUID REFERENCES rpa_machine(id),
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

ALTER TABLE rpa_robot
    ADD COLUMN IF NOT EXISTS cloud_flow_url TEXT;

ALTER TABLE rpa_robot
    ADD COLUMN IF NOT EXISTS desktop_flow_url TEXT;

UPDATE rpa_robot
SET
    cloud_flow_url = COALESCE(
        cloud_flow_url,
        CASE
            WHEN power_automate_environment_id IS NOT NULL AND cloud_flow_id IS NOT NULL
                THEN 'https://make.powerautomate.com/manage/environments/' ||
                    power_automate_environment_id || '/flows/' || cloud_flow_id || '/details'
            WHEN power_automate_url LIKE '%/flows/%' THEN power_automate_url
            ELSE NULL
        END
    ),
    desktop_flow_url = COALESCE(
        desktop_flow_url,
        CASE
            WHEN power_automate_environment_id IS NOT NULL AND desktop_flow_id IS NOT NULL
                THEN 'https://make.powerautomate.com/manage/environments/' ||
                    power_automate_environment_id || '/uiflows/' || desktop_flow_id || '/details'
            WHEN power_automate_url LIKE '%/uiflows/%' THEN power_automate_url
            ELSE NULL
        END
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

ALTER TABLE rpa_robot
    ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES rpa_machine(id);

-- Heartbeat agents report $env:COMPUTERNAME in upper case, while robots are often
-- registered with a hand typed machine name. A case sensitive UNIQUE constraint let
-- both spellings exist as separate rows, so the registered machine never received a
-- heartbeat. Merge the case variants into one canonical row before enforcing a case
-- insensitive unique index.
DO $$
DECLARE
    duplicate_row RECORD;
BEGIN
    FOR duplicate_row IN
        SELECT
            machine.id AS duplicate_id,
            canonical.id AS canonical_id
        FROM rpa_machine AS machine
        JOIN (
            SELECT DISTINCT ON (LOWER(machine_name))
                id,
                LOWER(machine_name) AS name_key
            FROM rpa_machine
            ORDER BY LOWER(machine_name), last_heartbeat_at DESC NULLS LAST, created_at
        ) AS canonical ON canonical.name_key = LOWER(machine.machine_name)
        WHERE machine.id <> canonical.id
    LOOP
        UPDATE rpa_machine AS canonical
        SET
            machine_ip = COALESCE(canonical.machine_ip, duplicate.machine_ip),
            anydesk_id = COALESCE(canonical.anydesk_id, duplicate.anydesk_id),
            last_heartbeat_at = GREATEST(
                canonical.last_heartbeat_at,
                duplicate.last_heartbeat_at
            ),
            heartbeat_metadata = COALESCE(
                canonical.heartbeat_metadata,
                duplicate.heartbeat_metadata
            )
        FROM rpa_machine AS duplicate
        WHERE canonical.id = duplicate_row.canonical_id
          AND duplicate.id = duplicate_row.duplicate_id;

        UPDATE rpa_robot
        SET machine_id = duplicate_row.canonical_id
        WHERE machine_id = duplicate_row.duplicate_id;

        DELETE FROM rpa_machine WHERE id = duplicate_row.duplicate_id;
    END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_rpa_machine_name_lower
    ON rpa_machine (LOWER(machine_name));

INSERT INTO rpa_machine (machine_name, machine_ip, anydesk_id)
SELECT
    MIN(BTRIM(machine_name)),
    MAX(NULLIF(BTRIM(machine_ip), '')),
    MAX(NULLIF(BTRIM(anydesk_id), ''))
FROM rpa_robot
WHERE NULLIF(BTRIM(machine_name), '') IS NOT NULL
GROUP BY LOWER(BTRIM(machine_name))
ON CONFLICT (LOWER(machine_name)) DO UPDATE SET
    machine_ip = COALESCE(rpa_machine.machine_ip, EXCLUDED.machine_ip),
    anydesk_id = COALESCE(rpa_machine.anydesk_id, EXCLUDED.anydesk_id);

UPDATE rpa_robot AS robot
SET machine_id = machine.id
FROM rpa_machine AS machine
WHERE robot.machine_id IS NULL
  AND LOWER(BTRIM(robot.machine_name)) = LOWER(machine.machine_name);

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

-- Reference material for a robot: process diagrams, support engineering guides,
-- specifications. Metadata only, so listing documents never reads binary data.
CREATE TABLE IF NOT EXISTS rpa_robot_document (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    robot_id UUID NOT NULL REFERENCES rpa_robot(id) ON DELETE CASCADE,
    document_type VARCHAR(30) NOT NULL DEFAULT 'OTHER',
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(150) NOT NULL,
    byte_size INTEGER NOT NULL,
    description TEXT,
    uploaded_by UUID REFERENCES rpa_app_user(id) ON DELETE SET NULL,
    uploaded_by_name VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_document_type CHECK (
        document_type IN ('PROCESS_DIAGRAM', 'SUPPORT_GUIDE', 'SPECIFICATION', 'OTHER')
    ),
    CONSTRAINT chk_document_byte_size CHECK (
        byte_size > 0 AND byte_size <= 10485760
    ),
    CONSTRAINT chk_document_file_name CHECK (BTRIM(file_name) <> '')
);

-- The bytes live in their own table. Several queries in this project select
-- whole rows, and keeping the payload separate guarantees none of them ever
-- drags megabytes of file content along.
CREATE TABLE IF NOT EXISTS rpa_robot_document_content (
    document_id UUID PRIMARY KEY REFERENCES rpa_robot_document(id) ON DELETE CASCADE,
    content BYTEA NOT NULL
);

-- Improvement requests raised against a robot. New entries stay open at the top
-- of the list until a developer marks them done.
CREATE TABLE IF NOT EXISTS rpa_robot_suggestion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    robot_id UUID NOT NULL REFERENCES rpa_robot(id) ON DELETE CASCADE,
    title VARCHAR(300) NOT NULL,
    details TEXT,
    is_done BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES rpa_app_user(id) ON DELETE SET NULL,
    created_by_name VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_by UUID REFERENCES rpa_app_user(id) ON DELETE SET NULL,
    completed_by_name VARCHAR(200),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_suggestion_title CHECK (BTRIM(title) <> ''),
    CONSTRAINT chk_suggestion_done CHECK (
        (is_done = FALSE AND completed_at IS NULL)
        OR (is_done = TRUE AND completed_at IS NOT NULL)
    )
);

-- Machine status is computed on read, so nothing on its own records the moment
-- a machine stopped reporting. This column remembers what was last announced,
-- which is what makes a transition detectable. NULL means never observed yet,
-- and is deliberately not treated as a transition, so the first pass after a
-- deployment records the current state instead of announcing every machine.
ALTER TABLE rpa_machine
    ADD COLUMN IF NOT EXISTS notified_status VARCHAR(20);

-- Category is intentionally left unconstrained. Only MACHINE_OFFLINE exists
-- today, and a CHECK listing one value would have to be dropped and recreated
-- the moment a second kind of notification is added.
CREATE TABLE IF NOT EXISTS rpa_notification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(30) NOT NULL,
    title VARCHAR(300) NOT NULL,
    body TEXT,
    machine_id UUID REFERENCES rpa_machine(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_notification_title CHECK (BTRIM(title) <> '')
);

-- Read state is per person: one operator opening the panel must not clear the
-- dot for everyone else. A missing row means unread.
CREATE TABLE IF NOT EXISTS rpa_notification_read (
    notification_id UUID NOT NULL REFERENCES rpa_notification(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES rpa_app_user(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rpa_robot_active
    ON rpa_robot(is_active);
CREATE INDEX IF NOT EXISTS idx_rpa_robot_machine
    ON rpa_robot(machine_id);
CREATE INDEX IF NOT EXISTS idx_rpa_machine_active
    ON rpa_machine(is_active);
CREATE INDEX IF NOT EXISTS idx_rpa_machine_last_heartbeat
    ON rpa_machine(last_heartbeat_at DESC);
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
CREATE INDEX IF NOT EXISTS idx_rpa_robot_document_robot
    ON rpa_robot_document(robot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rpa_robot_suggestion_robot
    ON rpa_robot_suggestion(robot_id, is_done, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rpa_notification_created
    ON rpa_notification(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rpa_notification_machine
    ON rpa_notification(machine_id, category);
CREATE INDEX IF NOT EXISTS idx_rpa_notification_read_user
    ON rpa_notification_read(user_id);

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

DROP TRIGGER IF EXISTS trg_rpa_machine_updated_at ON rpa_machine;
CREATE TRIGGER trg_rpa_machine_updated_at
BEFORE UPDATE ON rpa_machine
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rpa_app_user_updated_at ON rpa_app_user;
CREATE TRIGGER trg_rpa_app_user_updated_at
BEFORE UPDATE ON rpa_app_user
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rpa_robot_run_updated_at ON rpa_robot_run;
CREATE TRIGGER trg_rpa_robot_run_updated_at
BEFORE UPDATE ON rpa_robot_run
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rpa_robot_suggestion_updated_at ON rpa_robot_suggestion;
CREATE TRIGGER trg_rpa_robot_suggestion_updated_at
BEFORE UPDATE ON rpa_robot_suggestion
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
