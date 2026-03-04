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

function rethrowFriendlyConnectionError(err, cfg) {
  if (err?.code === "ENOTFOUND") {
    const host = cfg?.connectionString
      ? extractHostFromConnectionString(cfg.connectionString)
      : cfg?.host;
    throw new Error(
      `Could not resolve database host${host ? ` (${host})` : ""}. Check your connection string/server host and DNS settings.`
    );
  }
  throw err;
}

async function listTables(conn) {
  const engine = normalizeEngine(conn.engine);
  const cfg = buildConfig(conn);

  try {
    if (engine === "postgresql") {
      const client = new Client(cfg.connectionString ? { connectionString: cfg.connectionString } : cfg);
      await client.connect();
      const result = await client.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `);
      await client.end();
      return result.rows.map((r) => ({ schema: r.table_schema, name: r.table_name }));
    }

    if (engine === "mysql") {
      const connection = cfg.connectionString
        ? await mysql.createConnection(cfg.connectionString)
        : await mysql.createConnection(cfg);
      const [rows] = await connection.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `);
      await connection.end();
      return rows.map((row) => ({ schema: row.TABLE_SCHEMA, name: row.TABLE_NAME }));
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
      const result = await pool
        .request()
        .query(`
          SELECT TABLE_SCHEMA, TABLE_NAME
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE='BASE TABLE'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `);
      await pool.close();
      return result.recordset.map((r) => ({ schema: r.TABLE_SCHEMA, name: r.TABLE_NAME }));
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
      const client = new Client(cfg.connectionString ? { connectionString: cfg.connectionString } : cfg);
      await client.connect();
      const result = await client.query(query);
      await client.end();
      return { columns: result.fields.map((f) => f.name), rows: result.rows.slice(0, 200) };
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

module.exports = { listTables, runQuery };
