const mysql = require("mysql2/promise");
const { Client } = require("pg");
const sql = require("mssql");
const { ensureReadOnlyQuery } = require("./queryGuard");

function normalizeEngine(engine) {
  return String(engine || "").toLowerCase();
}

function normalizeConnectionString(engine, connectionString) {
  const value = String(connectionString || "").trim();
  if (!value) return null;

  if (engine === "postgresql" && !/^postgres(ql)?:\/\//i.test(value)) {
    throw new Error(
      "Invalid PostgreSQL connection string. Expected format like: postgresql://user:password@host:5432/database"
    );
  }

  if (engine === "mysql" && !/^mysql:\/\//i.test(value)) {
    throw new Error(
      "Invalid MySQL connection string. Expected format like: mysql://user:password@host:3306/database"
    );
  }

  if (engine === "mssql") {
    const looksLikeUrl = /^mssql:\/\//i.test(value);
    const looksLikeKv = /Server=|Data Source=|User Id=|Database=/i.test(value);
    if (!looksLikeUrl && !looksLikeKv) {
      throw new Error(
        "Invalid MSSQL connection string. Use mssql://user:password@host:1433/database or ADO style key/value string."
      );
    }
  }

  return value;
}

function buildConfig(conn) {
  const engine = normalizeEngine(conn.engine);
  const normalizedCs = normalizeConnectionString(engine, conn.connection_string);
  if (normalizedCs) {
    return { connectionString: normalizedCs };
  }

  const missing = [];
  if (!conn.server) missing.push("server");
  if (!conn.database_name) missing.push("database_name");
  if (!conn.db_username) missing.push("db_username");
  if (!conn.db_password) missing.push("db_password");
  if (missing.length > 0) {
    throw new Error(
      `Missing server-based connection fields: ${missing.join(", ")}. Provide a valid connection string or complete server fields.`
    );
  }

  return {
    host: conn.server,
    port: conn.port ? Number(conn.port) : undefined,
    database: conn.database_name,
    user: conn.db_username,
    password: conn.db_password,
  };
}

function extractHostFromConnectionString(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return parsed.hostname;
  } catch {
    return null;
  }
}

function groupObjectsBySchema(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const schema = row.schema || row.table_schema || row.routine_schema || "default";
    if (!grouped.has(schema)) grouped.set(schema, { schema, tables: [], procedures: [] });
  });
  return grouped;
}

function formatSchemaTree(tableRows, procedureRows) {
  const grouped = groupObjectsBySchema([...tableRows, ...procedureRows]);

  tableRows.forEach((row) => {
    const schema = row.schema || row.table_schema || "default";
    const name = row.name || row.table_name;
    grouped.get(schema).tables.push({ name });
  });

  procedureRows.forEach((row) => {
    const schema = row.schema || row.routine_schema || "default";
    const name = row.name || row.routine_name;
    grouped.get(schema).procedures.push({ name });
  });

  return Array.from(grouped.values())
    .map((s) => ({
      schema: s.schema,
      tables: s.tables.sort((a, b) => a.name.localeCompare(b.name)),
      procedures: s.procedures.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.schema.localeCompare(b.schema));
}

function resolveTargetPgSslConfig(forceEnable = false) {
  const sslMode = String(process.env.TARGET_DB_SSLMODE || "").toLowerCase();
  const enabledByEnv = ["require", "verify-ca", "verify-full", "true", "1"].includes(sslMode);
  const enabled = forceEnable || enabledByEnv;
  if (!enabled) return undefined;

  const rejectUnauthorized =
    String(process.env.TARGET_DB_SSL_REJECT_UNAUTHORIZED || "false").toLowerCase() === "true";
  return { rejectUnauthorized };
}

function shouldRetryPgWithSsl(err) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("no pg_hba.conf entry") && message.includes("no encryption");
}

function buildPgClientConfig(cfg, forceSsl = false) {
  const ssl = resolveTargetPgSslConfig(forceSsl);
  const base = cfg.connectionString ? { connectionString: cfg.connectionString } : { ...cfg };
  if (ssl) base.ssl = ssl;
  return base;
}

async function withPgClient(cfg, runner, { retryOnNoEncryption = true } = {}) {
  const firstConfig = buildPgClientConfig(cfg, false);
  const firstClient = new Client(firstConfig);

  try {
    await firstClient.connect();
    const out = await runner(firstClient);
    await firstClient.end();
    return out;
  } catch (err) {
    try {
      await firstClient.end();
    } catch {
      // ignore close errors
    }

    if (retryOnNoEncryption && shouldRetryPgWithSsl(err)) {
      const retryClient = new Client(buildPgClientConfig(cfg, true));
      try {
        await retryClient.connect();
        const out = await runner(retryClient);
        await retryClient.end();
        return out;
      } catch (retryErr) {
        try {
          await retryClient.end();
        } catch {
          // ignore close errors
        }
        throw retryErr;
      }
    }

    throw err;
  }
}

function rethrowFriendlyConnectionError(err, cfg) {
  if (err?.code === "ENOTFOUND") {
    const host = cfg?.connectionString ? extractHostFromConnectionString(cfg.connectionString) : cfg?.host;
    throw new Error(
      `Could not resolve database host${host ? ` (${host})` : ""}. Check your connection string/server host and DNS settings.`
    );
  }

  if (shouldRetryPgWithSsl(err)) {
    throw new Error(
      "The PostgreSQL server requires SSL/TLS encryption. Set TARGET_DB_SSLMODE=require (and optionally TARGET_DB_SSL_REJECT_UNAUTHORIZED=false) then retry."
    );
  }

  throw err;
}

async function listTables(conn) {
  const engine = normalizeEngine(conn.engine);
  const cfg = buildConfig(conn);

  try {
    if (engine === "postgresql") {
      return withPgClient(
        cfg,
        async (client) => {
          const tableResult = await client.query(`
            SELECT table_schema AS schema, table_name AS name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name
          `);
          const procedureResult = await client.query(`
            SELECT routine_schema AS schema, routine_name AS name
            FROM information_schema.routines
            WHERE routine_type = 'PROCEDURE'
              AND routine_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY routine_schema, routine_name
          `);
          return formatSchemaTree(tableResult.rows, procedureResult.rows);
        },
        { retryOnNoEncryption: true }
      );
    }

    if (engine === "mysql") {
      const connection = cfg.connectionString
        ? await mysql.createConnection(cfg.connectionString)
        : await mysql.createConnection(cfg);
      const [tableRows] = await connection.query(`
        SELECT TABLE_SCHEMA AS schema, TABLE_NAME AS name
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `);
      const [procedureRows] = await connection.query(`
        SELECT ROUTINE_SCHEMA AS schema, ROUTINE_NAME AS name
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_TYPE = 'PROCEDURE'
          AND ROUTINE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
      `);
      await connection.end();
      return formatSchemaTree(tableRows, procedureRows);
    }

    if (engine === "mssql") {
      const pool = await sql.connect(
        cfg.connectionString
          ? cfg.connectionString
          : {
              server: cfg.host,
              port: cfg.port,
              database: cfg.database,
              user: cfg.user,
              password: cfg.password,
              options: { encrypt: false, trustServerCertificate: true },
            }
      );
      const tableResult = await pool
        .request()
        .query(`
          SELECT TABLE_SCHEMA AS schema, TABLE_NAME AS name
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE='BASE TABLE'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `);
      const procedureResult = await pool
        .request()
        .query(`
          SELECT ROUTINE_SCHEMA AS schema, ROUTINE_NAME AS name
          FROM INFORMATION_SCHEMA.ROUTINES
          WHERE ROUTINE_TYPE='PROCEDURE'
          ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        `);
      await pool.close();
      return formatSchemaTree(tableResult.recordset, procedureResult.recordset);
    }

    throw new Error(`Unsupported engine: ${conn.engine}. Supported engines: postgresql, mysql, mssql.`);
  } catch (err) {
    rethrowFriendlyConnectionError(err, cfg);
  }
}

async function runQuery(conn, query) {
  ensureReadOnlyQuery(query);
  const engine = normalizeEngine(conn.engine);
  const cfg = buildConfig(conn);

  try {
    if (engine === "postgresql") {
      return withPgClient(
        cfg,
        async (client) => {
          const result = await client.query(query);
          return { columns: result.fields.map((f) => f.name), rows: result.rows.slice(0, 200) };
        },
        { retryOnNoEncryption: true }
      );
    }

    if (engine === "mysql") {
      const connection = cfg.connectionString
        ? await mysql.createConnection(cfg.connectionString)
        : await mysql.createConnection(cfg);
      const [rows, fields] = await connection.query(query);
      await connection.end();
      return {
        columns: fields ? fields.map((f) => f.name) : [],
        rows: Array.isArray(rows) ? rows.slice(0, 200) : [],
      };
    }

    if (engine === "mssql") {
      const pool = await sql.connect(
        cfg.connectionString
          ? cfg.connectionString
          : {
              server: cfg.host,
              port: cfg.port,
              database: cfg.database,
              user: cfg.user,
              password: cfg.password,
              options: { encrypt: false, trustServerCertificate: true },
            }
      );
      const result = await pool.request().query(query);
      await pool.close();
      return {
        columns: result.recordset.length ? Object.keys(result.recordset[0]) : [],
        rows: result.recordset.slice(0, 200),
      };
    }

    throw new Error(`Unsupported engine: ${conn.engine}. Supported engines: postgresql, mysql, mssql.`);
  } catch (err) {
    rethrowFriendlyConnectionError(err, cfg);
  }
}

module.exports = {
  listTables,
  runQuery,
  // exported for tests
  shouldRetryPgWithSsl,
  resolveTargetPgSslConfig,
};
