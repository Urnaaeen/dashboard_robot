# PostgreSQL Schema

## Relationship

```text
rpa_robot
  1:N rpa_robot_run
       1:N rpa_run_event
       1:N rpa_control_action
  1:N rpa_control_action
```

`rpa_environment` table intentionally does not exist.
`power_automate_environment_id` is a column on `rpa_robot`.

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

Only display labels and connection metadata are stored. These fields do not exist:

```text
password
anydesk_password
power_automate_password
```

Production database credentials must be supplied through `DATABASE_URL` and must
not be committed to the repository.
