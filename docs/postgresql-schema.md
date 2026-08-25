# PostgreSQL Schema

## Relationship

```text
rpa_robot
  N:1 rpa_machine
  1:N rpa_robot_run
       1:N rpa_run_event
       1:N rpa_control_action
  1:N rpa_control_action

rpa_app_user
  1:N rpa_user_session

rpa_daily_run_counter
  daily sequence used by rpa_robot_run.input_reference

rpa_machine
  heartbeat-based RUNNING / IDLE / OFFLINE / NOT_CONNECTED availability
```

`rpa_environment` table intentionally does not exist.
`power_automate_environment_id` and `account_name` are columns on `rpa_robot`.
`rpa_daily_run_counter` atomically generates Ulaanbaatar-local references in
`invoice-batch-YYYY-MM-DD-001` format and resets the visible sequence each day.

`rpa_machine.last_heartbeat_at`-g machine agent 1 minut tutam shinechilne. API
active `rpa_robot_run` baival `RUNNING`, ugui bol heartbeat 3 minutaas shine ued
`IDLE`, umnu heartbeat irj baisan ch tasarsan bol `OFFLINE`, heartbeat ogt irj
baigaagui bol `NOT_CONNECTED` gej tootsoolno. `rpa_robot.machine_id` ni machine
master record ruu holbogdono; huuchin machine text columns ni run snapshot bolon
backward compatibility-d hadgalagdana.

## Dashboard query

The API loads active robots and their latest run with a lateral join:

```sql
SELECT latest_run.*
FROM rpa_robot robot
JOIN LATERAL (
    SELECT *
    FROM rpa_robot_run robot_run
    WHERE robot_run.robot_id = robot.id
    ORDER BY robot_run.started_at DESC
    LIMIT 1
) latest_run ON TRUE
WHERE robot.is_active = TRUE;
```

## Security boundary

Robot and Power Automate passwords are not stored. These fields do not exist:

```text
password
anydesk_password
power_automate_password
```

Production database credentials must be supplied through `DATABASE_URL` and must
not be committed to the repository.

Dashboard credentials are stored separately in `rpa_app_user`. Only salted
`scrypt` password hashes are stored. Browser session tokens are kept as SHA-256
hashes in `rpa_user_session`; public user registration is not available.
