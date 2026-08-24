# RPA Central Monitoring Dashboard

PostgreSQL deer ajilladag RPA robot inventory bolon latest run monitoring dashboard.

`rpa_environment` table baihgui. Power Automate Environment ID, account label,
machine, AnyDesk medeelel bugd `rpa_robot` table deer hadgalagdana.

Password, AnyDesk password, Power Automate account password hadgalah column esvel
API field baihgui.

## Ajilluulah

Docker Desktop ajillaj baigaa ued:

```powershell
Copy-Item .env.example .env
# .env dotor local password-aa tohiruulna
docker compose up -d
npm run db:seed
npm start
```

Dashboard:

```text
http://localhost:5173
```

Swagger UI:

```text
http://localhost:5173/swagger
```

OpenAPI JSON:

```text
http://localhost:5173/openapi.json
```

`npm run db:seed` ni schema, indexes bolon neg test robot/run uusgene. Seed ni
idempotent tul dahin ajilluulahad davhardahgui.

## Database configuration

Local connection-iig `.env` file-aar tohiruulna. `.env` ni Git-d orohgui.
Jishee:

```text
postgresql://rpa_user:YOUR_LOCAL_PASSWORD@localhost:5433/rpa_monitoring
```

Production esvel uur PostgreSQL ashiglah bol:

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/rpa_monitoring"
$env:PGSSL="true"
npm run db:init
npm start
```

Jishee configuration-g [.env.example](.env.example)-ees harna uu.

## Database schema

- `rpa_robot`: robot identity, Power Automate IDs, account label, machine, AnyDesk, monitoring config
- `rpa_robot_run`: status, start/end, duration, run IDs, error, retry, metadata
- `rpa_run_event`: run detail events
- `rpa_control_action`: future Retry, Resubmit, Run Now, Cancel actions

SQL migration: [database/schema.sql](database/schema.sql)

Seed data: [database/seed.sql](database/seed.sql)

## API endpoints

```text
GET  /api/health
GET  /api/dashboard
POST /api/robots
POST /api/logger/start
POST /api/logger/success
POST /api/logger/failed
POST /api/logger/event
POST /api/runs/status
```

Robot register/update:

```json
{
  "robotCode": "ITZONE_RECEIPT",
  "robotName": "ITZONE Receipt Bot",
  "robotType": "CLOUD_DESKTOP",
  "powerAutomateEnvironmentId": "Default-xxxxxxxx",
  "accountLabel": "Robot Account 02",
  "machineName": "BOT-PC-02",
  "machineIp": "10.0.0.22",
  "anydeskId": "123 456 789",
  "anydeskAlias": "itzone-receipt-bot",
  "maxExpectedRunMinutes": 30
}
```

Robot start:

```json
{
  "robotId": "00000000-0000-4000-8000-000000000001",
  "machineName": "BOT-PC-02",
  "cloudFlowRunId": "flow-run-001"
}
```

START response-iin `robotRun.robotRunId`-g Power Automate flow dotor hadgalaad
SUCCESS/FAILED endpoint-d damjuulna.
