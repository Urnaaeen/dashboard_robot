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
PATCH /api/robots/:robotId/active
PATCH /api/robots/:robotId/power-automate
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

## Power Automate Edge profile launcher

Dashboard-iin **Open Cloud Flow** bolon **Open Desktop Flow** tovch ni robot-iin
`accountName`-tai ijil nertei Microsoft Edge profile-iig neene. Jishee ni Edge
profile-iin haragdah ner `NEXT` bol robot-iin Account Name bas yag `NEXT` baina.
Email hayag esvel uur ner profile songohgui.

Windows computer bur deer launcher-iig neg udaa suulgana:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-power-automate-profile-launcher.ps1
```

Installer ni `rpa-power-automate://` local protocol-iig current Windows user-d
burtgene. Anh tovch darahad browser confirmation haruulbal neehig zuvshuurnu.
Launcher ni zuvhun `https://make.powerautomate.com` hayag neeh baidlaar
hyazgaarlagdsan. Dashboard server deer suulgah shaardlagagui; tovch darj baigaa
Windows computer deer suulgasan baina.

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

`Machines` delgets deer status ni gants asuultand hariulna: machine asaalttai
baigaa eseh. Uunig zuvhun heartbeat togtoono. Robot-iin ajliin achaalal bol tusdaa
dohio, uchir ni unasan robot-iin uldeesen RUNNING run ni host amid gedgiig
ogt batlahgui:

- `NOT_CONNECTED`: heartbeat agent neg ch udaa medeelel ilgeegeegui
- `OFFLINE`: suuliin heartbeat `MACHINE_OFFLINE_SECONDS`-oos huuchin
- `ONLINE`: suuliin heartbeat ug hugatsaanii dotor irsen

Robot-iin ajil ni `Running Robot` bagana deer tusad ni temdeglegdene. RUNNING run
baival `1 running` temdeg garna. `max_expected_run_minutes` hetersen bol temdeg
ulaan bolj `passed the expected duration` gesen tailbar nemegdene.

Machine ONLINE bish baigaad RUNNING run uldsen bol status door
`1 run is still RUNNING while the machine is not reporting` gesen seremjluuleg
garna. Ene ni robot machine untarah esvel unahad run-aa haaj chadaagui gesen ug.

Offline bolohoos umnuh hugatsaag `.env`-iin `MACHINE_OFFLINE_SECONDS`-oor
tohiruulna (default 180 secund, 30-oos 86400 hoorondh utga). Dashboard ug utgiig
API-aas avch KPI text deer haruulna.

Machine name tom, jijig useg ylgahgui davhardahgui. Heartbeat agent
`$env:COMPUTERNAME`-g TOM usgeer ilgeedeg tul garaar `Bot-PC-02` gej burtgesen
machine ch mun neg mor deer ochno. Umnu uussen davhardsan moruudiig schema
migration avtomataar negtgene.

### Suulgah

Machine buriin PowerShell-iig Administrator-aar neegeed:

```powershell
.\scripts\install-machine-heartbeat-task.ps1 `
  -ApiBaseUrl "https://rpa.example.com" `
  -ApiKey "YOUR_32_CHARACTER_OR_LONGER_SECRET"
```

Installer ni:

- agent script-iig `C:\ProgramData\RpaMonitoring` ruu huulna
- API key-g zuvhun SYSTEM bolon Administrators unshij chadah
  `C:\ProgramData\RpaMonitoring\api-key.txt` file-d hadgalna
- Task Scheduler-aar 1 minut tutam ajilluulah task uusgene
- duusahiin umnu neg heartbeat ilgeej shalgana

Shalgah heartbeat amjiltgui bol installer aldaanii shaltgaaniig helj, exit code
butsaana. Ug ued task suusan ch ajillahgui tul log-g harna uu.

Umnuh huvilbariin machine-wide `RPA_API_KEY` environment variable ni shalgalt
amjilttai bolsnii daraa avtomataar ustana.

### Garaar neg udaa test hiih

```powershell
.\scripts\send-machine-heartbeat.ps1 `
  -ApiBaseUrl "http://localhost:5173" `
  -ApiKey "YOUR_32_CHARACTER_OR_LONGER_SECRET"
```

### Onoshloh

Agent hezee ch chimeegui unadaggui. Ur dun bur log-d bichigdene:

```powershell
Get-Content C:\ProgramData\RpaMonitoring\heartbeat.log -Tail 20
Get-ScheduledTaskInfo -TaskName 'RPA Monitoring Machine Heartbeat'
```

Exit code-uud:

- `0`: heartbeat huleen avsan
- `1`: configuration aldaa (API key baihgui, URL buruu)
- `2`: dashboard tatgalzsan esvel holbogdoj chadaagui
- `3`: agent-iin gadnah aldaa

Heartbeat endpoint ni ug machine baihgui bol uusgene, bgaa bol IP, AnyDesk ID,
heartbeat time bolon metadata-g shinechilne. Mun `machine_id`-gui uldsen robot-uudiig
nereer ni holbono.

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
