INSERT INTO rpa_robot (
    id,
    robot_code,
    robot_name,
    robot_type,
    power_automate_environment_id,
    cloud_flow_id,
    cloud_flow_name,
    desktop_flow_id,
    desktop_flow_name,
    power_automate_url,
    account_name,
    machine_name,
    machine_ip,
    anydesk_id,
    max_expected_run_minutes
)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'ITZONE_RECEIPT',
    'ITZONE Receipt Bot',
    'CLOUD_DESKTOP',
    'Default-xxxxxxxx',
    'cloud-flow-itzone-receipt',
    'ITZONE Receipt Main Flow',
    'desktop-flow-itzone-receipt',
    'ITZONE Receipt PAD',
    'https://make.powerautomate.com/manage/environments/Default-xxxxxxxx/uiflows/desktop-flow-itzone-receipt/details',
    'Robot Account 02',
    'BOT-PC-02',
    '10.0.0.22',
    '123 456 789',
    30
)
ON CONFLICT (robot_code) DO NOTHING;

INSERT INTO rpa_robot_run (
    id,
    robot_id,
    status,
    started_at,
    ended_at,
    duration_seconds,
    cloud_flow_run_id,
    desktop_flow_session_id,
    machine_name,
    error_code,
    error_message,
    error_step
)
VALUES (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'FAILED',
    NOW() - INTERVAL '15 minutes',
    NOW() - INTERVAL '10 minutes',
    300,
    'sample-cloud-run-001',
    'sample-desktop-session-001',
    'BOT-PC-02',
    'EXCEL_LOCKED',
    'Excel file is locked by another process',
    'Open Excel'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rpa_run_event (
    id,
    robot_run_id,
    event_type,
    step_name,
    message,
    event_data,
    created_at
)
VALUES
    (
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'INFO',
        'Monitoring Start',
        'Run record created.',
        '{"source":"seed"}'::jsonb,
        NOW() - INTERVAL '15 minutes'
    ),
    (
        '20000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000001',
        'ERROR',
        'Open Excel',
        'Excel file is locked by another process',
        '{"errorCode":"EXCEL_LOCKED"}'::jsonb,
        NOW() - INTERVAL '10 minutes'
    )
ON CONFLICT (id) DO NOTHING;
