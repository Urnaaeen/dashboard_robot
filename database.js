const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Create .env from .env.example.");
}

const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const NOTIFICATION_RETENTION_DAYS = 10;

const MACHINE_OFFLINE_SECONDS = Number(process.env.MACHINE_OFFLINE_SECONDS || 180);

if (
  !Number.isInteger(MACHINE_OFFLINE_SECONDS) ||
  MACHINE_OFFLINE_SECONDS < 30 ||
  MACHINE_OFFLINE_SECONDS > 86400
) {
  throw new Error("MACHINE_OFFLINE_SECONDS must be an integer between 30 and 86400.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
  connectionTimeoutMillis: 5000,
});

function readSql(filename) {
  return fs.readFileSync(path.join(__dirname, "database", filename), "utf8");
}

function nullable(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function jsonValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return JSON.stringify(value);
}

function mapRobot(row) {
  return {
    robotId: row.id,
    robotCode: row.robot_code,
    robotName: row.robot_name,
    robotType: row.robot_type,
    powerAutomateEnvironmentId: row.power_automate_environment_id,
    cloudFlowId: row.cloud_flow_id,
    cloudFlowName: row.cloud_flow_name,
    cloudTriggerName: row.cloud_trigger_name,
    cloudFlowUrl: row.cloud_flow_url,
    desktopFlowId: row.desktop_flow_id,
    desktopFlowName: row.desktop_flow_name,
    desktopFlowUrl: row.desktop_flow_url,
    powerAutomateUrl: row.power_automate_url,
    accountName: row.account_name,
    machineId: row.machine_id,
    machineName: row.machine_name,
    machineIp: row.machine_ip,
    anydeskId: row.anydesk_id,
    maxExpectedRunMinutes: row.max_expected_run_minutes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMachine(row) {
  return {
    machineId: row.id,
    machineName: row.machine_name,
    machineIp: row.machine_ip,
    anydeskId: row.anydesk_id,
    status: row.status || "NOT_CONNECTED",
    lastHeartbeatAt: row.last_heartbeat_at,
    heartbeatAgeSeconds:
      row.heartbeat_age_seconds === null || row.heartbeat_age_seconds === undefined
        ? null
        : Number(row.heartbeat_age_seconds),
    staleRunningCount: Number(row.stale_running_count || 0),
    heartbeatMetadata: row.heartbeat_metadata,
    robotCount: Number(row.robot_count || 0),
    runningRunCount: Number(row.running_run_count || 0),
    robotNames: row.robot_names || [],
    runningRobotNames: row.running_robot_names || [],
    lastRunStartedAt: row.last_run_started_at,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRobotRun(row) {
  return {
    robotRunId: row.id,
    robotId: row.robot_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    cloudFlowRunId: row.cloud_flow_run_id,
    desktopFlowSessionId: row.desktop_flow_session_id,
    machineName: row.machine_name,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    errorStep: row.error_step,
    retryCount: row.retry_count,
    retryOfRunId: row.retry_of_run_id,
    inputReference: row.input_reference,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRunHistory(row) {
  return {
    ...mapRobotRun(row),
    robotCode: row.robot_code,
    robotName: row.robot_name,
    accountName: row.account_name,
    powerAutomateEnvironmentId: row.power_automate_environment_id,
    powerAutomateUrl: row.power_automate_url,
    maxExpectedRunMinutes: row.max_expected_run_minutes,
  };
}

function mapRunEvent(row) {
  return {
    runEventId: row.id,
    robotRunId: row.robot_run_id,
    eventType: row.event_type,
    stepName: row.step_name,
    message: row.message,
    eventData: row.event_data,
    createdAt: row.created_at,
  };
}

function mapNotification(row) {
  return {
    notificationId: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    machineId: row.machine_id,
    machineName: row.machine_name,
    createdAt: row.created_at,
    isRead: Boolean(row.is_read),
  };
}

function mapRobotDocument(row) {
  return {
    documentId: row.id,
    robotId: row.robot_id,
    documentType: row.document_type,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    description: row.description,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

function mapRobotSuggestion(row) {
  return {
    suggestionId: row.id,
    robotId: row.robot_id,
    title: row.title,
    details: row.details,
    isDone: row.is_done,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    completedBy: row.completed_by,
    completedByName: row.completed_by_name,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function mapAppUser(row) {
  return {
    userId: row.user_id || row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function translateDatabaseError(error) {
  if (error.statusCode) {
    return error;
  }
  if (error.code === "23505") {
    if (error.constraint === "rpa_app_user_username_key") {
      return httpError("Username must be unique.", 409);
    }
    return httpError("robotCode must be unique.", 409);
  }
  if (["22P02", "22007", "22023", "23503", "23514"].includes(error.code)) {
    return httpError(error.detail || error.message, 400);
  }
  return error;
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw translateDatabaseError(error);
  } finally {
    client.release();
  }
}

async function initializeSchema() {
  await pool.query(readSql("schema.sql"));
}

async function seedSampleData() {
  await pool.query(readSql("seed.sql"));
}

async function ping() {
  const result = await pool.query("SELECT current_database() AS database_name, NOW() AS database_time");
  return result.rows[0];
}

async function findUserByUsername(username) {
  const result = await pool.query(
    `
      SELECT *
      FROM rpa_app_user
      WHERE username = $1
      LIMIT 1
    `,
    [String(username || "").trim().toLowerCase()],
  );
  if (!result.rowCount) {
    return null;
  }
  return {
    ...mapAppUser(result.rows[0]),
    passwordHash: result.rows[0].password_hash,
  };
}

async function createOrUpdateUser({ username, displayName, passwordHash, role, isActive = true }) {
  try {
    const result = await pool.query(
      `
        INSERT INTO rpa_app_user (
          username, display_name, password_hash, role, is_active
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (username) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          is_active = EXCLUDED.is_active
        RETURNING *
      `,
      [username, displayName, passwordHash, role, isActive],
    );
    return mapAppUser(result.rows[0]);
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

async function createUserSession({ userId, tokenHash, expiresAt, userAgent, ipAddress }) {
  return withTransaction(async (client) => {
    await client.query("DELETE FROM rpa_user_session WHERE expires_at <= NOW()");
    await client.query(
      `
        DELETE FROM rpa_user_session
        WHERE user_id = $1
          AND id NOT IN (
            SELECT id
            FROM rpa_user_session
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 4
          )
      `,
      [userId],
    );
    await client.query(
      `
        INSERT INTO rpa_user_session (
          user_id, token_hash, expires_at, user_agent, ip_address
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, tokenHash, expiresAt, nullable(userAgent), nullable(ipAddress)],
    );
    await client.query("UPDATE rpa_app_user SET last_login_at = NOW() WHERE id = $1", [userId]);
  });
}

async function getUserBySessionTokenHash(tokenHash) {
  const result = await pool.query(
    `
      SELECT
        app_user.id AS user_id,
        app_user.username,
        app_user.display_name,
        app_user.role,
        app_user.is_active,
        app_user.last_login_at,
        app_user.created_at,
        app_user.updated_at,
        user_session.expires_at AS session_expires_at,
        user_session.last_seen_at AS session_last_seen_at
      FROM rpa_user_session AS user_session
      JOIN rpa_app_user AS app_user ON app_user.id = user_session.user_id
      WHERE user_session.token_hash = $1
        AND user_session.expires_at > NOW()
        AND app_user.is_active = TRUE
      LIMIT 1
    `,
    [tokenHash],
  );
  if (!result.rowCount) {
    return null;
  }
  const row = result.rows[0];
  if (Date.now() - new Date(row.session_last_seen_at).getTime() > 5 * 60 * 1000) {
    await pool.query(
      "UPDATE rpa_user_session SET last_seen_at = NOW() WHERE token_hash = $1",
      [tokenHash],
    );
  }
  return {
    ...mapAppUser(row),
    sessionExpiresAt: row.session_expires_at,
  };
}

async function deleteUserSession(tokenHash) {
  await pool.query("DELETE FROM rpa_user_session WHERE token_hash = $1", [tokenHash]);
}

async function getDashboardData() {
  const [robotResult, runResult, machines] = await Promise.all([
    pool.query(`
      SELECT *
      FROM rpa_robot
      ORDER BY robot_name
    `),
    pool.query(`
      SELECT latest_run.*
      FROM rpa_robot robot
      JOIN LATERAL (
        SELECT *
        FROM rpa_robot_run robot_run
        WHERE robot_run.robot_id = robot.id
        ORDER BY robot_run.started_at DESC
        LIMIT 1
      ) latest_run ON TRUE
      ORDER BY latest_run.started_at DESC
    `),
    getMachines(),
  ]);

  const runIds = runResult.rows.map((row) => row.id);
  const eventResult = runIds.length
    ? await pool.query(
        `
          SELECT *
          FROM rpa_run_event
          WHERE robot_run_id = ANY($1::uuid[])
          ORDER BY created_at DESC
        `,
        [runIds],
      )
    : { rows: [] };

  return {
    robots: robotResult.rows.map(mapRobot),
    robotRuns: runResult.rows.map(mapRobotRun),
    runEvents: eventResult.rows.map(mapRunEvent),
    machines,
  };
}

async function getMachines({ machineId = null } = {}) {
  const result = await pool.query(
    `
    WITH robot_summary AS (
      SELECT
        machine_id,
        COUNT(*) AS robot_count,
        ARRAY_AGG(robot_name ORDER BY robot_name) AS robot_names
      FROM rpa_robot
      WHERE is_active = TRUE
        AND machine_id IS NOT NULL
      GROUP BY machine_id
    ), running_summary AS (
      SELECT
        robot.machine_id,
        COUNT(*) AS running_run_count,
        COUNT(*) FILTER (
          WHERE robot_run.started_at
            < NOW() - make_interval(mins => robot.max_expected_run_minutes)
        ) AS stale_running_count,
        ARRAY_AGG(DISTINCT robot.robot_name ORDER BY robot.robot_name) AS running_robot_names,
        MAX(robot_run.started_at) AS last_run_started_at
      FROM rpa_robot_run AS robot_run
      JOIN rpa_robot AS robot ON robot.id = robot_run.robot_id
      WHERE robot_run.status = 'RUNNING'
        AND robot.is_active = TRUE
        AND robot.machine_id IS NOT NULL
      GROUP BY robot.machine_id
    )
    SELECT
      machine.*,
      COALESCE(robot_summary.robot_count, 0) AS robot_count,
      COALESCE(robot_summary.robot_names, ARRAY[]::text[]) AS robot_names,
      COALESCE(running_summary.running_run_count, 0) AS running_run_count,
      COALESCE(running_summary.stale_running_count, 0) AS stale_running_count,
      COALESCE(running_summary.running_robot_names, ARRAY[]::text[]) AS running_robot_names,
      running_summary.last_run_started_at,
      EXTRACT(EPOCH FROM (NOW() - machine.last_heartbeat_at))::INTEGER AS heartbeat_age_seconds,
      -- Status answers one question only: is the machine powered on and
      -- reporting? Robot workload is a separate signal, because a run left in
      -- RUNNING by a crashed robot says nothing about the host being alive.
      CASE
        WHEN machine.last_heartbeat_at IS NULL THEN 'NOT_CONNECTED'
        WHEN machine.last_heartbeat_at < NOW() - make_interval(secs => $1::integer) THEN 'OFFLINE'
        ELSE 'ONLINE'
      END AS status
    FROM rpa_machine AS machine
    LEFT JOIN robot_summary ON robot_summary.machine_id = machine.id
    LEFT JOIN running_summary ON running_summary.machine_id = machine.id
    WHERE machine.is_active = TRUE
      AND ($2::uuid IS NULL OR machine.id = $2::uuid)
    ORDER BY
      CASE
        WHEN machine.last_heartbeat_at IS NULL THEN 4
        WHEN machine.last_heartbeat_at < NOW() - make_interval(secs => $1::integer) THEN 3
        WHEN COALESCE(running_summary.running_run_count, 0) > 0 THEN 1
        ELSE 2
      END,
      machine.machine_name
  `,
    [MACHINE_OFFLINE_SECONDS, machineId],
  );
  return result.rows.map(mapMachine);
}

async function upsertMachine(executor, payload, { heartbeat = false } = {}) {
  const machineName = String(payload.machineName || "").trim();
  if (!machineName) {
    throw httpError("machineName cannot be blank.", 400);
  }
  const result = await executor.query(
    `
      INSERT INTO rpa_machine (
        machine_name, machine_ip, anydesk_id, last_heartbeat_at, heartbeat_metadata
      )
      VALUES ($1, $2, $3, CASE WHEN $4 THEN NOW() ELSE NULL END, $5::jsonb)
      ON CONFLICT (LOWER(machine_name)) DO UPDATE SET
        machine_ip = COALESCE(EXCLUDED.machine_ip, rpa_machine.machine_ip),
        anydesk_id = COALESCE(EXCLUDED.anydesk_id, rpa_machine.anydesk_id),
        last_heartbeat_at = CASE
          WHEN $4 THEN NOW()
          ELSE rpa_machine.last_heartbeat_at
        END,
        heartbeat_metadata = CASE
          WHEN $4 THEN EXCLUDED.heartbeat_metadata
          ELSE rpa_machine.heartbeat_metadata
        END,
        is_active = TRUE
      RETURNING *
    `,
    [
      machineName,
      nullable(payload.machineIp),
      nullable(payload.anydeskId),
      heartbeat,
      jsonValue(payload.metadata),
    ],
  );
  return result.rows[0];
}

async function recordMachineHeartbeat(payload) {
  const row = await upsertMachine(pool, payload, { heartbeat: true });
  // A robot registered before its machine started reporting has no machine_id yet.
  // Adopt it here so the heartbeat immediately counts towards the right machine.
  await pool.query(
    `
      UPDATE rpa_robot
      SET machine_id = $1
      WHERE machine_id IS NULL
        AND LOWER(BTRIM(machine_name)) = LOWER($2)
    `,
    [row.id, row.machine_name],
  );
  const machines = await getMachines({ machineId: row.id });
  return machines[0] || mapMachine(row);
}

async function getRunHistory({ search, status, startedFrom, startedTo, limit }) {
  const normalizedSearch = String(search || "").trim().slice(0, 200);
  const normalizedStatus = String(status || "ALL").trim().toUpperCase();
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const result = await pool.query(
    `
      SELECT
        robot_run.*,
        robot.robot_code,
        robot.robot_name,
        robot.account_name,
        robot.power_automate_environment_id,
        robot.power_automate_url,
        robot.max_expected_run_minutes,
        COUNT(*) OVER() AS total_count
      FROM rpa_robot_run AS robot_run
      JOIN rpa_robot AS robot ON robot.id = robot_run.robot_id
      WHERE (
        $1 = ''
        OR robot.robot_name ILIKE '%' || $1 || '%'
        OR robot.robot_code ILIKE '%' || $1 || '%'
        OR robot_run.id::text ILIKE '%' || $1 || '%'
        OR COALESCE(robot_run.machine_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(robot_run.error_code, '') ILIKE '%' || $1 || '%'
        OR COALESCE(robot_run.error_message, '') ILIKE '%' || $1 || '%'
        OR COALESCE(robot_run.error_step, '') ILIKE '%' || $1 || '%'
        OR COALESCE(robot_run.input_reference, '') ILIKE '%' || $1 || '%'
      )
        AND ($2 = 'ALL' OR robot_run.status = $2)
        AND ($3::timestamptz IS NULL OR robot_run.started_at >= $3::timestamptz)
        AND ($4::timestamptz IS NULL OR robot_run.started_at < $4::timestamptz)
      ORDER BY robot_run.started_at DESC
      LIMIT $5
    `,
    [
      normalizedSearch,
      normalizedStatus,
      nullable(startedFrom),
      nullable(startedTo),
      safeLimit,
    ],
  );

  return {
    runs: result.rows.map(mapRunHistory),
    total: Number(result.rows[0]?.total_count || 0),
    limit: safeLimit,
  };
}

function buildCloudFlowUrl(payload) {
  const explicitUrl = nullable(payload.cloudFlowUrl ?? payload.powerAutomateUrl);
  if (explicitUrl) return explicitUrl;
  const environmentId = nullable(payload.powerAutomateEnvironmentId);
  const cloudFlowId = nullable(payload.cloudFlowId);
  return environmentId && cloudFlowId
    ? `https://make.powerautomate.com/manage/environments/${environmentId}/flows/${cloudFlowId}/details`
    : null;
}

function buildDesktopFlowUrl(payload) {
  const explicitUrl = nullable(payload.desktopFlowUrl);
  if (explicitUrl) return explicitUrl;
  const environmentId = nullable(payload.powerAutomateEnvironmentId);
  const desktopFlowId = nullable(payload.desktopFlowId);
  return environmentId && desktopFlowId
    ? `https://make.powerautomate.com/manage/environments/${environmentId}/uiflows/${desktopFlowId}/details`
    : null;
}

async function saveRobot(executor, payload, robotCode) {
  const machine = await upsertMachine(executor, payload);
  const cloudFlowUrl = buildCloudFlowUrl(payload);
  const desktopFlowUrl = buildDesktopFlowUrl(payload);
  const values = [
    robotCode,
    String(payload.robotName || "").trim(),
    payload.robotType || "CLOUD_DESKTOP",
    nullable(payload.powerAutomateEnvironmentId),
    nullable(payload.cloudFlowId),
    nullable(payload.cloudFlowName),
    nullable(payload.cloudTriggerName),
    cloudFlowUrl,
    nullable(payload.desktopFlowId),
    nullable(payload.desktopFlowName),
    desktopFlowUrl,
    cloudFlowUrl || desktopFlowUrl,
    nullable(payload.accountName ?? payload.accountLabel),
    machine.id,
    nullable(payload.machineName),
    nullable(payload.machineIp),
    nullable(payload.anydeskId),
    Number(payload.maxExpectedRunMinutes || 60),
    payload.isActive !== false,
  ];

  try {
    const result = await executor.query(
      `
        INSERT INTO rpa_robot (
          robot_code, robot_name, robot_type, power_automate_environment_id,
          cloud_flow_id, cloud_flow_name, cloud_trigger_name, cloud_flow_url,
          desktop_flow_id, desktop_flow_name, desktop_flow_url,
          power_automate_url, account_name, machine_name,
          machine_ip, anydesk_id, max_expected_run_minutes, is_active, machine_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $15, $16, $17, $18, $19, $14
        )
        RETURNING *
      `,
      values,
    );
    return mapRobot(result.rows[0]);
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

async function generateRobotCode(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('rpa_robot_code_generation'))");
  const result = await client.query(`
    SELECT COALESCE(MAX(SUBSTRING(robot_code FROM '^RPA-([0-9]{6})$')::INTEGER), 0) + 1
      AS next_number
    FROM rpa_robot
    WHERE robot_code ~ '^RPA-[0-9]{6}$'
  `);
  const nextNumber = Number(result.rows[0].next_number);
  if (nextNumber > 999999) {
    throw httpError("Robot code range RPA-000001 to RPA-999999 is exhausted.", 409);
  }
  return `RPA-${String(nextNumber).padStart(6, "0")}`;
}

async function createRobot(payload) {
  return withTransaction(async (client) => {
    const generatedCode = await generateRobotCode(client);
    return saveRobot(client, payload, generatedCode);
  });
}

async function updateRobotActive(robotId, isActive) {
  const result = await pool.query(
    `
      UPDATE rpa_robot
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [robotId, isActive],
  );
  if (!result.rowCount) {
    throw httpError(`Robot not found: ${robotId}`, 404);
  }
  return mapRobot(result.rows[0]);
}

async function updateRobotPowerAutomate(robotId, payload) {
  const cloudFlowUrl = buildCloudFlowUrl(payload);
  const desktopFlowUrl = buildDesktopFlowUrl(payload);
  const result = await pool.query(
    `
      UPDATE rpa_robot
      SET
        power_automate_environment_id = $2,
        cloud_flow_id = $3,
        cloud_flow_name = $4,
        cloud_flow_url = $5,
        desktop_flow_id = $6,
        desktop_flow_name = $7,
        desktop_flow_url = $8,
        power_automate_url = $9,
        account_name = $10,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      robotId,
      nullable(payload.powerAutomateEnvironmentId),
      nullable(payload.cloudFlowId),
      nullable(payload.cloudFlowName),
      cloudFlowUrl,
      nullable(payload.desktopFlowId),
      nullable(payload.desktopFlowName),
      desktopFlowUrl,
      cloudFlowUrl || desktopFlowUrl,
      nullable(payload.accountName),
    ],
  );
  if (!result.rowCount) {
    throw httpError(`Robot not found: ${robotId}`, 404);
  }
  return mapRobot(result.rows[0]);
}

async function generateInputReference(client, startedAt) {
  const result = await client.query(
    `
      WITH run_day AS (
        SELECT (
          COALESCE($1::timestamptz, NOW()) AT TIME ZONE 'Asia/Ulaanbaatar'
        )::date AS value
      ), next_counter AS (
        INSERT INTO rpa_daily_run_counter (run_date, last_value)
        SELECT
          value,
          COALESCE((
            SELECT MAX(SUBSTRING(robot_run.input_reference FROM '([0-9]+)$')::integer)
            FROM rpa_robot_run AS robot_run
            WHERE robot_run.input_reference ~ (
              '^invoice-batch-' || TO_CHAR(run_day.value, 'YYYY-MM-DD') || '-[0-9]+$'
            )
          ), 0) + 1
        FROM run_day
        ON CONFLICT (run_date) DO UPDATE
        SET
          last_value = rpa_daily_run_counter.last_value + 1,
          updated_at = NOW()
        RETURNING run_date, last_value
      )
      SELECT
        'invoice-batch-' || TO_CHAR(run_date, 'YYYY-MM-DD') || '-' ||
          LPAD(last_value::text, 3, '0') AS input_reference
      FROM next_counter
    `,
    [nullable(startedAt)],
  );
  return result.rows[0].input_reference;
}

async function startRobotRun(payload) {
  return withTransaction(async (client) => {
    const robotCode = String(payload.robotCode || "").trim();
    const robotResult = await client.query(
      "SELECT * FROM rpa_robot WHERE robot_code = $1",
      [robotCode],
    );
    if (!robotResult.rowCount) {
      throw httpError(`Robot not found: ${robotCode}`, 404);
    }
    const robot = robotResult.rows[0];
    if (!robot.is_active) {
      throw httpError(`Robot is turned off: ${robotCode}`, 409);
    }
    const inputReference = await generateInputReference(client, payload.startedAt);
    const runResult = await client.query(
      `
        INSERT INTO rpa_robot_run (
          id, robot_id, status, started_at, cloud_flow_run_id,
          desktop_flow_session_id, machine_name, retry_count,
          retry_of_run_id, input_reference, metadata
        )
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()), $2, 'RUNNING',
          COALESCE($3::timestamptz, NOW()), $4, $5, COALESCE($6, $7),
          $8, $9::uuid, $10, $11::jsonb
        )
        RETURNING *
      `,
      [
        nullable(payload.robotRunId),
        robot.id,
        nullable(payload.startedAt),
        nullable(payload.cloudFlowRunId),
        nullable(payload.desktopFlowSessionId),
        nullable(payload.machineName),
        robot.machine_name,
        Number(payload.retryCount || 0),
        nullable(payload.retryOfRunId),
        inputReference,
        jsonValue(payload.metadata),
      ],
    );
    const run = runResult.rows[0];
    await client.query(
      `
        INSERT INTO rpa_run_event (robot_run_id, event_type, step_name, message, event_data, created_at)
        VALUES ($1, 'INFO', $2, $3, $4::jsonb, $5)
      `,
      [
        run.id,
        payload.stepName || "Monitoring Start",
        payload.message || "Run record created.",
        jsonValue(payload.eventData),
        run.started_at,
      ],
    );
    return mapRobotRun(run);
  });
}

async function finishRobotRun(payload, status) {
  return withTransaction(async (client) => {
    const isFailed = status === "FAILED";
    const robotCode = String(payload.robotCode || "").trim();
    const cloudFlowRunId = nullable(payload.cloudFlowRunId);
    const runningResult = await client.query(
      `
        SELECT robot_run.*
        FROM rpa_robot_run AS robot_run
        JOIN rpa_robot AS robot ON robot.id = robot_run.robot_id
        WHERE robot.robot_code = $1
          AND robot_run.status = 'RUNNING'
          AND ($2::text IS NULL OR robot_run.cloud_flow_run_id = $2)
        ORDER BY robot_run.started_at DESC, robot_run.created_at DESC
        LIMIT 2
        FOR UPDATE OF robot_run
      `,
      [robotCode, cloudFlowRunId],
    );
    if (!runningResult.rowCount) {
      const suffix = cloudFlowRunId ? ` with cloudFlowRunId ${cloudFlowRunId}` : "";
      throw httpError(`RUNNING run not found for robotCode ${robotCode}${suffix}.`, 404);
    }
    if (runningResult.rowCount > 1) {
      const message = cloudFlowRunId
        ? `Multiple RUNNING runs use cloudFlowRunId ${cloudFlowRunId} for robotCode ${robotCode}.`
        : `Multiple RUNNING runs found for robotCode ${robotCode}. Include cloudFlowRunId to identify the run.`;
      throw httpError(
        message,
        409,
      );
    }
    const targetRun = runningResult.rows[0];
    const result = await client.query(
      `
        UPDATE rpa_robot_run
        SET
          status = $2::text,
          ended_at = COALESCE($3::timestamptz, NOW()),
          duration_seconds = GREATEST(
            0,
            EXTRACT(EPOCH FROM (COALESCE($3::timestamptz, NOW()) - started_at))::INTEGER
          ),
          error_code = $4,
          error_message = $5,
          error_step = $6
        WHERE id = $1
        RETURNING *
      `,
      [
        targetRun.id,
        status,
        nullable(payload.endedAt),
        isFailed ? payload.errorCode || "ERR_UNKNOWN" : null,
        isFailed ? payload.errorMessage : null,
        isFailed ? payload.errorStep || payload.stepName || "Unknown Step" : null,
      ],
    );
    if (!result.rowCount) {
      throw httpError(`Robot run not found: ${targetRun.id}`, 404);
    }

    const run = result.rows[0];
    await client.query(
      `
        INSERT INTO rpa_run_event (robot_run_id, event_type, step_name, message, event_data, created_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        run.id,
        isFailed ? "ERROR" : "INFO",
        isFailed ? run.error_step : payload.stepName || "Monitoring Success",
        isFailed ? run.error_message : payload.message || "Run completed successfully.",
        jsonValue(payload.eventData),
        run.ended_at,
      ],
    );
    return mapRobotRun(run);
  });
}

async function createRunEvent(payload) {
  try {
    const result = await pool.query(
      `
        INSERT INTO rpa_run_event (
          robot_run_id, event_type, step_name, message, event_data, created_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()))
        RETURNING *
      `,
      [
        payload.robotRunId,
        String(payload.eventType).toUpperCase(),
        nullable(payload.stepName),
        payload.message,
        jsonValue(payload.eventData),
        nullable(payload.createdAt),
      ],
    );
    return mapRunEvent(result.rows[0]);
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

async function updateRunStatus(payload) {
  const status = String(payload.status).toUpperCase();
  const terminalStatuses = ["SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"];
  try {
    const result = await pool.query(
      `
        UPDATE rpa_robot_run
        SET
          status = $2::text,
          ended_at = CASE
            WHEN $2::text = ANY($3::text[]) THEN COALESCE($4::timestamptz, $5::timestamptz, NOW())
            ELSE ended_at
          END,
          duration_seconds = CASE
            WHEN $2::text = ANY($3::text[]) THEN GREATEST(
              0,
              EXTRACT(EPOCH FROM (COALESCE($4::timestamptz, $5::timestamptz, NOW()) - started_at))::INTEGER
            )
            ELSE duration_seconds
          END,
          error_code = COALESCE($6, error_code),
          error_message = COALESCE($7, error_message),
          error_step = COALESCE($8, error_step)
        WHERE id = $1
        RETURNING *
      `,
      [
        payload.robotRunId,
        status,
        terminalStatuses,
        nullable(payload.endedAt),
        nullable(payload.updatedAt),
        nullable(payload.errorCode),
        nullable(payload.errorMessage),
        nullable(payload.errorStep),
      ],
    );
    if (!result.rowCount) {
      throw httpError(`Robot run not found: ${payload.robotRunId}`, 404);
    }
    return mapRobotRun(result.rows[0]);
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

async function assertRobotExists(executor, robotId) {
  const result = await executor.query("SELECT id FROM rpa_robot WHERE id = $1", [robotId]);
  if (!result.rowCount) {
    throw httpError(`Robot not found: ${robotId}`, 404);
  }
}

async function getRobotDocuments(robotId) {
  const result = await pool.query(
    `
      SELECT *
      FROM rpa_robot_document
      WHERE robot_id = $1
      ORDER BY created_at DESC
    `,
    [robotId],
  );
  return result.rows.map(mapRobotDocument);
}

async function createRobotDocument(payload) {
  const content = payload.content;
  if (!Buffer.isBuffer(content) || !content.length) {
    throw httpError("The uploaded file is empty.", 400);
  }
  if (content.length > DOCUMENT_MAX_BYTES) {
    throw httpError(
      `The file exceeds the ${Math.floor(DOCUMENT_MAX_BYTES / (1024 * 1024))} MB limit.`,
      413,
    );
  }

  return withTransaction(async (client) => {
    await assertRobotExists(client, payload.robotId);
    const documentResult = await client.query(
      `
        INSERT INTO rpa_robot_document (
          robot_id, document_type, file_name, content_type,
          byte_size, description, uploaded_by, uploaded_by_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        payload.robotId,
        payload.documentType || "OTHER",
        String(payload.fileName || "").trim().slice(0, 255),
        String(payload.contentType || "application/octet-stream").slice(0, 150),
        content.length,
        nullable(payload.description),
        nullable(payload.uploadedBy),
        nullable(payload.uploadedByName),
      ],
    );
    const document = documentResult.rows[0];
    await client.query(
      "INSERT INTO rpa_robot_document_content (document_id, content) VALUES ($1, $2)",
      [document.id, content],
    );
    return mapRobotDocument(document);
  });
}

async function getRobotDocumentContent(documentId) {
  const result = await pool.query(
    `
      SELECT
        document.*,
        document_content.content
      FROM rpa_robot_document AS document
      JOIN rpa_robot_document_content AS document_content
        ON document_content.document_id = document.id
      WHERE document.id = $1
    `,
    [documentId],
  );
  if (!result.rowCount) {
    throw httpError(`Document not found: ${documentId}`, 404);
  }
  const row = result.rows[0];
  return { ...mapRobotDocument(row), content: row.content };
}

async function deleteRobotDocument(documentId) {
  // The content row goes with it through ON DELETE CASCADE.
  const result = await pool.query(
    "DELETE FROM rpa_robot_document WHERE id = $1 RETURNING *",
    [documentId],
  );
  if (!result.rowCount) {
    throw httpError(`Document not found: ${documentId}`, 404);
  }
  return mapRobotDocument(result.rows[0]);
}

async function getRobotSuggestions(robotId) {
  // Open items first, newest at the top of each group, so a fresh suggestion
  // lands where the reader is looking.
  const result = await pool.query(
    `
      SELECT *
      FROM rpa_robot_suggestion
      WHERE robot_id = $1
      ORDER BY is_done, created_at DESC
    `,
    [robotId],
  );
  return result.rows.map(mapRobotSuggestion);
}

async function createRobotSuggestion(payload) {
  const title = String(payload.title || "").trim();
  if (!title) {
    throw httpError("title cannot be blank.", 400);
  }
  return withTransaction(async (client) => {
    await assertRobotExists(client, payload.robotId);
    const result = await client.query(
      `
        INSERT INTO rpa_robot_suggestion (
          robot_id, title, details, created_by, created_by_name
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [
        payload.robotId,
        title.slice(0, 300),
        nullable(payload.details),
        nullable(payload.createdBy),
        nullable(payload.createdByName),
      ],
    );
    return mapRobotSuggestion(result.rows[0]);
  });
}

async function setRobotSuggestionDone(suggestionId, isDone, actor = {}) {
  const result = await pool.query(
    `
      UPDATE rpa_robot_suggestion
      SET
        is_done = $2,
        completed_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
        completed_by_name = CASE WHEN $2 THEN $4 ELSE NULL END,
        completed_at = CASE WHEN $2 THEN NOW() ELSE NULL END
      WHERE id = $1
      RETURNING *
    `,
    [suggestionId, isDone, nullable(actor.userId), nullable(actor.displayName)],
  );
  if (!result.rowCount) {
    throw httpError(`Suggestion not found: ${suggestionId}`, 404);
  }
  return mapRobotSuggestion(result.rows[0]);
}

async function deleteRobotSuggestion(suggestionId) {
  const result = await pool.query(
    "DELETE FROM rpa_robot_suggestion WHERE id = $1 RETURNING *",
    [suggestionId],
  );
  if (!result.rowCount) {
    throw httpError(`Suggestion not found: ${suggestionId}`, 404);
  }
  return mapRobotSuggestion(result.rows[0]);
}

// Machine status is derived from the heartbeat on every read, so a change of
// state leaves no trace of its own. This compares the live status against the
// one last announced and turns the difference into notifications.
//
// Only two transitions matter. ONLINE to OFFLINE raises a notification.
// OFFLINE back to ONLINE deletes it again, because an incident that fixed
// itself should leave the list rather than sit there needing to be dismissed.
// A NULL notified_status means the machine has not been observed yet and is
// recorded without announcing anything, which keeps a fresh deployment quiet.
async function syncMachineNotifications() {
  return withTransaction(async (client) => {
    const offlineMinutes = Math.round(MACHINE_OFFLINE_SECONDS / 60);
    const currentStatus = `
      SELECT
        id,
        machine_name,
        notified_status,
        CASE
          WHEN last_heartbeat_at IS NULL THEN 'NOT_CONNECTED'
          WHEN last_heartbeat_at < NOW() - make_interval(secs => $1::integer) THEN 'OFFLINE'
          ELSE 'ONLINE'
        END AS status
      FROM rpa_machine
      WHERE is_active = TRUE
    `;

    const raised = await client.query(
      `
        WITH current AS (${currentStatus})
        INSERT INTO rpa_notification (category, title, body, machine_id)
        SELECT
          'MACHINE_OFFLINE',
          machine_name || ' stopped reporting',
          'No heartbeat for more than ' || $2::text || ' minutes. The machine may be '
            || 'powered off, asleep, or disconnected from the network.',
          id
        FROM current
        WHERE status = 'OFFLINE'
          AND notified_status = 'ONLINE'
        RETURNING machine_id
      `,
      [MACHINE_OFFLINE_SECONDS, offlineMinutes],
    );

    const resolved = await client.query(
      `
        WITH current AS (${currentStatus})
        DELETE FROM rpa_notification
        WHERE category = 'MACHINE_OFFLINE'
          AND machine_id IN (
            SELECT id FROM current WHERE status = 'ONLINE' AND notified_status = 'OFFLINE'
          )
        RETURNING machine_id
      `,
      [MACHINE_OFFLINE_SECONDS],
    );

    await client.query(
      `
        WITH current AS (${currentStatus})
        UPDATE rpa_machine AS machine
        SET notified_status = current.status
        FROM current
        WHERE machine.id = current.id
          AND machine.notified_status IS DISTINCT FROM current.status
      `,
      [MACHINE_OFFLINE_SECONDS],
    );

    const purged = await client.query(
      `
        DELETE FROM rpa_notification
        WHERE created_at < NOW() - make_interval(days => $1::integer)
        RETURNING id
      `,
      [NOTIFICATION_RETENTION_DAYS],
    );

    return {
      raised: raised.rowCount,
      resolved: resolved.rowCount,
      purged: purged.rowCount,
    };
  });
}

async function getNotifications(userId, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const result = await pool.query(
    `
      SELECT
        notification.*,
        machine.machine_name,
        (read_state.notification_id IS NOT NULL) AS is_read
      FROM rpa_notification AS notification
      LEFT JOIN rpa_machine AS machine ON machine.id = notification.machine_id
      LEFT JOIN rpa_notification_read AS read_state
        ON read_state.notification_id = notification.id
       AND read_state.user_id = $1
      ORDER BY notification.created_at DESC
      LIMIT $2
    `,
    [userId, safeLimit],
  );
  return result.rows.map(mapNotification);
}

async function getUnreadNotificationCount(userId) {
  const result = await pool.query(
    `
      SELECT COUNT(*) AS unread
      FROM rpa_notification AS notification
      LEFT JOIN rpa_notification_read AS read_state
        ON read_state.notification_id = notification.id
       AND read_state.user_id = $1
      WHERE read_state.notification_id IS NULL
    `,
    [userId],
  );
  return Number(result.rows[0].unread || 0);
}

async function markNotificationsRead(userId, { notificationIds = null } = {}) {
  // A null id list means everything currently visible to this user.
  const result = await pool.query(
    `
      INSERT INTO rpa_notification_read (notification_id, user_id)
      SELECT id, $1
      FROM rpa_notification
      WHERE ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ON CONFLICT DO NOTHING
      RETURNING notification_id
    `,
    [userId, notificationIds],
  );
  return result.rowCount;
}

async function close() {
  await pool.end();
}

module.exports = {
  DOCUMENT_MAX_BYTES,
  MACHINE_OFFLINE_SECONDS,
  NOTIFICATION_RETENTION_DAYS,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  syncMachineNotifications,
  close,
  createRobot,
  createRobotDocument,
  createRobotSuggestion,
  deleteRobotDocument,
  deleteRobotSuggestion,
  getRobotDocumentContent,
  getRobotDocuments,
  getRobotSuggestions,
  setRobotSuggestionDone,
  createRunEvent,
  createOrUpdateUser,
  createUserSession,
  deleteUserSession,
  findUserByUsername,
  finishRobotRun,
  getDashboardData,
  getMachines,
  getRunHistory,
  getUserBySessionTokenHash,
  initializeSchema,
  ping,
  recordMachineHeartbeat,
  seedSampleData,
  startRobotRun,
  translateDatabaseError,
  updateRunStatus,
  updateRobotActive,
  updateRobotPowerAutomate,
};
