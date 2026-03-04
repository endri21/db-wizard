const mysql = require("mysql2/promise");
const { Client } = require("pg");
const sql = require("mssql");
const Database = require("better-sqlite3");
const { ensureReadOnlyQuery } = require("./queryGuard");

function normalizeEngine(engine) {
  return String(engine || "").toLowerCase();
}

function buildConfig(conn) {
  if (conn.connection_string) {
    return { connectionString: conn.connection_string };
  }

  return {
    host: conn.server,
    port: conn.port ? Number(conn.port) : undefined,
    database: conn.database_name,
    user: conn.db_username,
    password: conn.db_password,
  };
}

async function listTables(conn) {
  const engine = normalizeEngine(conn.engine);
  const cfg = buildConfig(conn);

  if (engine === "sqlite") {
    const sqlite = new Database((cfg.connectionString || "sqlite:///:memory:").replace("sqlite://", ""));
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    sqlite.close();
    return rows.map((r) => r.name);
  }

  if (engine === "postgresql") {
    const client = new Client(cfg.connectionString ? { connectionString: cfg.connectionString } : cfg);
    await client.connect();
    const result = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    await client.end();
    return result.rows.map((r) => r.table_name);
  }

  if (engine === "mysql") {
    const connection = cfg.connectionString
      ? await mysql.createConnection(cfg.connectionString)
      : await mysql.createConnection(cfg);
    const [rows] = await connection.query("SHOW TABLES");
    await connection.end();
    return rows.map((row) => Object.values(row)[0]);
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
    const result = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    await pool.close();
    return result.recordset.map((r) => r.TABLE_NAME);
  }

  throw new Error(`Unsupported engine: ${conn.engine}`);
}

async function runQuery(conn, query) {
  ensureReadOnlyQuery(query);
  const engine = normalizeEngine(conn.engine);
  const cfg = buildConfig(conn);

  if (engine === "sqlite") {
    const sqlite = new Database((cfg.connectionString || "sqlite:///:memory:").replace("sqlite://", ""));
    const rows = sqlite.prepare(query).all();
    sqlite.close();
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { columns, rows: rows.slice(0, 200) };
  }

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

  throw new Error(`Unsupported engine: ${conn.engine}`);
}

module.exports = { listTables, runQuery };
