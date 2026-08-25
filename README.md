# RPA Central Monitoring Dashboard

PostgreSQL deer ajilladag RPA robot inventory bolon latest run monitoring dashboard.

`rpa_environment` table baihgui. Power Automate Environment ID bolon account name
`rpa_robot` deer, machine heartbeat bolon availability ni `rpa_machine` deer hadgalagdana.

Password, AnyDesk password, Power Automate account password hadgalah column esvel
API field baihgui.

## Ajilluulah

Docker Desktop ajillaj baigaa ued:

```powershell
Copy-Item .env.example .env
# .env dotor local password-aa tohiruulna
docker compose up -d
npm run db:seed
npm run user:create -- --username admin --display-name "Dashboard Admin" --role ADMIN
npm start
```

`user:create` command password-iig terminal deer dald oruulna. Username davhardsan bol
tuhain hereglegchiin ner, role, password-iig shinechilne. Password ni plaintext bish,
salt-tai `scrypt` hash helbereer DB-d hadgalagdana.

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

## Authentication

Web registration endpoint bolon burtguuleh delgets baihgui. Hereglegchiig zuvhun
server/DB access-tai admin uusgene:

```powershell
npm run user:create -- --username operator01 --display-name "RPA Operator" --role OPERATOR
npm run user:create -- --username viewer01 --display-name "Monitoring Viewer" --role VIEWER
```

Role-uud:

- `ADMIN`: dashboard harah, robot nemeh/shinechleh, logging action hiih
- `OPERATOR`: dashboard harah, logging action hiih
- `VIEWER`: dashboard harah

Hereglegch haah bol pgAdmin Query Tool deer:

```sql
UPDATE rpa_app_user SET is_active = FALSE WHERE username = 'viewer01';
```

Dashboard, Swagger bolon monitoring API-uud DB session shaardana. Session cookie ni
`HttpOnly`, `SameSite=Strict`; token ni DB-d SHA-256 hash helbereer hadgalagdana.
Deployment deer `NODE_ENV=production` esvel `COOKIE_SECURE=true` tohiruulna.

Power Automate logger endpoint-uudad browser session-iin orond `.env`-iin
`RPA_API_KEY`-g `X-RPA-API-Key` header-aar damjuulj bolno. Dor hayaj 32
character-tai random key ashiglana.

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
$env:NODE_ENV="production"
$env:COOKIE_SECURE="true"
npm run db:init
npm start
```

Jishee configuration-g [.env.example](.env.example)-ees harna uu.

## Database schema

- `rpa_robot`: robot identity, Power Automate IDs, account name, machine, AnyDesk, monitoring config
- `rpa_machine`: machine identity, IP, AnyDesk ID, last heartbeat, agent metadata
- `rpa_robot_run`: status, start/end, duration, run IDs, error, retry, metadata
- `rpa_run_event`: run detail events
- `rpa_control_action`: future Retry, Resubmit, Run Now, Cancel actions
- `rpa_app_user`: dashboard username, password hash, role, active status
- `rpa_user_session`: hashed session token, expiry, last activity

SQL migration: [database/schema.sql](database/schema.sql)

Seed data: [database/seed.sql](database/seed.sql)

## API endpoints

```text
GET  /api/health
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/dashboard
GET  /api/history
GET  /api/machines
POST /api/machines/heartbeat
POST /api/robots
POST /api/logger/start
POST /api/logger/success
POST /api/logger/failed
POST /api/logger/event
POST /api/runs/status
```

`/api/health` bolon `/api/auth/login`-oos busad endpoint hamgaalalttai. Public
user registration API baihgui.

Robot register/update:

```json
{
  "robotName": "ITZONE Receipt Bot",
  "robotType": "CLOUD_DESKTOP",
  "powerAutomateEnvironmentId": "Default-xxxxxxxx",
  "accountName": "Robot Account 02",
  "machineName": "BOT-PC-02",
  "machineIp": "10.0.0.22",
  "anydeskId": "123 456 789"
}
```

`robotCode`-g client ilgeehgui. Server shine robot-d `RPA-000001` helbereer
davhardahgui code avtomataar olgono.

Robot start:

```json
{
  "robotCode": "RPA-000001",
  "machineName": "BOT-PC-02",
  "cloudFlowRunId": "flow-run-001"
}
```

Server `inputReference`-g Ulaanbaatar-iin odor bolon odor tutmiin daraalsan
dugaaraar `invoice-batch-YYYY-MM-DD-001` helbereer avtomataar uusgene.

SUCCESS/FAILED endpoint-d `robotCode`-g ilgeene. Neg robot deer olon RUNNING
run baival START deer ashiglasan `cloudFlowRunId`-g bas ilgeej yag run-iig songono.
START response-iin `robotRun.robotRunId` ni event bolon general status endpoint-d
ashiglagdsaar baina.

## Machine heartbeat

`Machines` delgets deer status daraah baidlaar tootsoologdono:

- `RUNNING`: machine-d holbootoi robot deer RUNNING run baina
- `IDLE`: suuliin 3 minutad heartbeat irsen, RUNNING run baihgui
- `OFFLINE`: umnu heartbeat irj baisan ch suuliin heartbeat 3 minutaas huuchin
- `NOT_CONNECTED`: heartbeat agent neg ch udaa medeelel ilgeegeegui

Neg udaagiin heartbeat test:

```powershell
$env:RPA_API_KEY="YOUR_32_CHARACTER_OR_LONGER_SECRET"
.\scripts\send-machine-heartbeat.ps1 -ApiBaseUrl "http://localhost:5173"
```

Machine buriin PowerShell-iig Administrator-aar neegeed scheduled task suulgana:

```powershell
.\scripts\install-machine-heartbeat-task.ps1 `
  -ApiBaseUrl "https://rpa.example.com" `
  -ApiKey "YOUR_32_CHARACTER_OR_LONGER_SECRET"
```

Installer ni heartbeat script-iig `C:\ProgramData\RpaMonitoring` ruu huulj, API
key-g machine environment variable-d hadgalaad Windows Task Scheduler-aar 1 minut
tutam ajilluulna. API key script esvel task argument dotor hadgalagdahgui.
Heartbeat endpoint ni ug machine baihgui bol uusgene, bgaa bol IP, AnyDesk ID,
heartbeat time bolon metadata-g shinechilne.

## Production Docker deployment

`docker-compose.prod.yml` ni Caddy, Node API/dashboard bolon PostgreSQL-iig tus
tusad ni container bolgon ajilluulna. PostgreSQL bolon Node port host ruu
neegddeggui. Caddy ni `APP_DOMAIN`-d TLS certificate avtomataar avch, HTTP-g HTTPS
ruu redirect hiine. Oracle Security List bolon server firewall deer TCP 80, 443
neelttei baina.

Server deer repository-g clone hiisnii daraa:

```bash
cp .env.example .env
```

`.env` dotor `APP_DOMAIN`-g domain nereer, `POSTGRES_PASSWORD`, `RPA_API_KEY`-g
shine random utgaar solij, `.env` file-iin permission-iig hyazgaarlana:

```bash
chmod 600 .env
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

App startup deer schema-g idempotent baidlaar initialize hiine. Anhnii admin
hereglegchiig interactive nuuts ugtei uusgene:

```bash
docker compose -f docker-compose.prod.yml exec app \
  npm run user:create -- --username admin --display-name "Dashboard Admin" --role ADMIN
```

Health check:

```bash
curl https://rpa-monitoring.duckdns.org/api/health
```
