const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Create .env from .env.example.");
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
    desktopFlowId: row.desktop_flow_id,
    desktopFlowName: row.desktop_flow_name,
    powerAutomateUrl: row.power_automate_url,
    accountLabel: row.account_label,
    machineName: row.machine_name,
    machineIp: row.machine_ip,
    anydeskId: row.anydesk_id,
    anydeskAlias: row.anydesk_alias,
    maxExpectedRunMinutes: row.max_expected_run_minutes,
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

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function translateDatabaseError(error) {
  if (error.statusCode) {
    return error;
  }
  if (error.code === "23505") {
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

async function getDashboardData() {
  const [robotResult, runResult] = await Promise.all([
    pool.query(`
      SELECT *
      FROM rpa_robot
      WHERE is_active = TRUE
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
      WHERE robot.is_active = TRUE
      ORDER BY latest_run.started_at DESC
    `),
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
  };
}

function buildPowerAutomateUrl(payload) {
  const explicitUrl = nullable(payload.powerAutomateUrl);
  if (explicitUrl) {
    return explicitUrl;
  }

  const environmentId = nullable(payload.powerAutomateEnvironmentId);
  if (!environmentId) {
    return null;
  }
  if (nullable(payload.desktopFlowId)) {
    return `https://make.powerautomate.com/manage/environments/${environmentId}/uiflows/${payload.desktopFlowId}/details`;
  }
  if (nullable(payload.cloudFlowId)) {
    return `https://make.powerautomate.com/manage/environments/${environmentId}/flows/${payload.cloudFlowId}/details`;
  }
  return null;
}

async function upsertRobot(payload) {
  const values = [
    String(payload.robotCode || "").trim().toUpperCase(),
    String(payload.robotName || "").trim(),
    payload.robotType || "CLOUD_DESKTOP",
    nullable(payload.powerAutomateEnvironmentId),
    nullable(payload.cloudFlowId),
    nullable(payload.cloudFlowName),
    nullable(payload.cloudTriggerName),
    nullable(payload.desktopFlowId),
    nullable(payload.desktopFlowName),
    buildPowerAutomateUrl(payload),
    nullable(payload.accountLabel),
    nullable(payload.machineName),
    nullable(payload.machineIp),
    nullable(payload.anydeskId),
    nullable(payload.anydeskAlias),
    Number(payload.maxExpectedRunMinutes || 60),
    payload.isActive !== false,
  ];

  try {
    const result = await pool.query(
      `
        INSERT INTO rpa_robot (
          robot_code, robot_name, robot_type, power_automate_environment_id,
          cloud_flow_id, cloud_flow_name, cloud_trigger_name, desktop_flow_id,
          desktop_flow_name, power_automate_url, account_label, machine_name,
          machine_ip, anydesk_id, anydesk_alias, max_expected_run_minutes, is_active
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17
        )
        ON CONFLICT (robot_code) DO UPDATE SET
          robot_name = EXCLUDED.robot_name,
          robot_type = EXCLUDED.robot_type,
          power_automate_environment_id = EXCLUDED.power_automate_environment_id,
          cloud_flow_id = EXCLUDED.cloud_flow_id,
          cloud_flow_name = EXCLUDED.cloud_flow_name,
          cloud_trigger_name = EXCLUDED.cloud_trigger_name,
          desktop_flow_id = EXCLUDED.desktop_flow_id,
          desktop_flow_name = EXCLUDED.desktop_flow_name,
          power_automate_url = EXCLUDED.power_automate_url,
          account_label = EXCLUDED.account_label,
          machine_name = EXCLUDED.machine_name,
          machine_ip = EXCLUDED.machine_ip,
          anydesk_id = EXCLUDED.anydesk_id,
          anydesk_alias = EXCLUDED.anydesk_alias,
          max_expected_run_minutes = EXCLUDED.max_expected_run_minutes,
          is_active = EXCLUDED.is_active
        RETURNING *
      `,
      values,
    );
    return mapRobot(result.rows[0]);
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

async function startRobotRun(payload) {
  return withTransaction(async (client) => {
    const robotResult = await client.query("SELECT * FROM rpa_robot WHERE id = $1 AND is_active = TRUE", [
      payload.robotId,
    ]);
    if (!robotResult.rowCount) {
      throw httpError(`Robot not found: ${payload.robotId}`, 404);
    }
    const robot = robotResult.rows[0];
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
        payload.robotId,
        nullable(payload.startedAt),
        nullable(payload.cloudFlowRunId),
        nullable(payload.desktopFlowSessionId),
        nullable(payload.machineName),
        robot.machine_name,
        Number(payload.retryCount || 0),
        nullable(payload.retryOfRunId),
        nullable(payload.inputReference),
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
    const result = await client.query(
      `
        UPDATE rpa_robot_run
        SET
          status = $2,
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
        payload.robotRunId,
        status,
        nullable(payload.endedAt),
        isFailed ? payload.errorCode || "ERR_UNKNOWN" : null,
        isFailed ? payload.errorMessage : null,
        isFailed ? payload.errorStep || payload.stepName || "Unknown Step" : null,
      ],
    );
    if (!result.rowCount) {
      throw httpError(`Robot run not found: ${payload.robotRunId}`, 404);
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
          status = $2,
          ended_at = CASE
            WHEN $2 = ANY($3::text[]) THEN COALESCE($4::timestamptz, $5::timestamptz, NOW())
            ELSE ended_at
          END,
          duration_seconds = CASE
            WHEN $2 = ANY($3::text[]) THEN GREATEST(
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

async function close() {
  await pool.end();
}

module.exports = {
  close,
  createRunEvent,
  finishRobotRun,
  getDashboardData,
  initializeSchema,
  ping,
  seedSampleData,
  startRobotRun,
  translateDatabaseError,
  updateRunStatus,
  upsertRobot,
};
