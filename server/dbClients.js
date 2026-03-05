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


async function listRelationships(conn, selectedTables = []) {
  const engine = normalizeEngine(conn.engine);
  const cfg = buildConfig(conn);
  const selectedSet = new Set((selectedTables || []).map((t) => String(t).toLowerCase()));
  const includeRel = (row) => {
    if (!selectedSet.size) return true;
    const from = `${row.from_schema}.${row.from_table}`.toLowerCase();
    const to = `${row.to_schema}.${row.to_table}`.toLowerCase();
    return selectedSet.has(from) || selectedSet.has(to);
  };

  try {
    if (engine === "postgresql") {
      const rows = await withPgClient(
        cfg,
        async (client) => {
          const result = await client.query(`
            SELECT tc.constraint_name,
                   tc.table_schema AS from_schema,
                   tc.table_name AS from_table,
                   kcu.column_name AS from_column,
                   ccu.table_schema AS to_schema,
                   ccu.table_name AS to_table,
                   ccu.column_name AS to_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.constraint_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            ORDER BY from_schema, from_table, constraint_name
          `);
          return result.rows;
        },
        { retryOnNoEncryption: true }
      );
      return rows.filter(includeRel);
    }

    if (engine === "mysql") {
      const connection = cfg.connectionString
        ? await mysql.createConnection(cfg.connectionString)
        : await mysql.createConnection(cfg);
      const [rows] = await connection.query(`
        SELECT kcu.CONSTRAINT_NAME AS constraint_name,
               kcu.TABLE_SCHEMA AS from_schema,
               kcu.TABLE_NAME AS from_table,
               kcu.COLUMN_NAME AS from_column,
               kcu.REFERENCED_TABLE_SCHEMA AS to_schema,
               kcu.REFERENCED_TABLE_NAME AS to_table,
               kcu.REFERENCED_COLUMN_NAME AS to_column
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY from_schema, from_table, constraint_name
      `);
      await connection.end();
      return rows.filter(includeRel);
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
      const result = await pool.request().query(`
        SELECT fk.name AS constraint_name,
               sch1.name AS from_schema,
               t1.name AS from_table,
               c1.name AS from_column,
               sch2.name AS to_schema,
               t2.name AS to_table,
               c2.name AS to_column
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        JOIN sys.tables t1 ON fkc.parent_object_id = t1.object_id
        JOIN sys.schemas sch1 ON t1.schema_id = sch1.schema_id
        JOIN sys.columns c1 ON c1.object_id = t1.object_id AND c1.column_id = fkc.parent_column_id
        JOIN sys.tables t2 ON fkc.referenced_object_id = t2.object_id
        JOIN sys.schemas sch2 ON t2.schema_id = sch2.schema_id
        JOIN sys.columns c2 ON c2.object_id = t2.object_id AND c2.column_id = fkc.referenced_column_id
        ORDER BY from_schema, from_table, constraint_name
      `);
      await pool.close();
      return result.recordset.filter(includeRel);
    }

    throw new Error(`Unsupported engine: ${conn.engine}. Supported engines: postgresql, mysql, mssql.`);
  } catch (err) {
    rethrowFriendlyConnectionError(err, cfg);
  }
}


async function listTableColumns(conn, tables = []) {
  const engine = normalizeEngine(conn.engine);
  const cfg = buildConfig(conn);
  const selected = new Set((tables || []).map((t) => String(t).toLowerCase()));

  try {
    if (engine === "postgresql") {
      const rows = await withPgClient(
        cfg,
        async (client) => {
          const result = await client.query(`
            SELECT c.table_schema AS schema,
                   c.table_name AS table_name,
                   c.column_name,
                   c.data_type,
                   c.is_nullable,
                   EXISTS (
                     SELECT 1
                     FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage kcu
                       ON tc.constraint_name = kcu.constraint_name
                      AND tc.table_schema = kcu.table_schema
                     WHERE tc.constraint_type = 'PRIMARY KEY'
                       AND tc.table_schema = c.table_schema
                       AND tc.table_name = c.table_name
                       AND kcu.column_name = c.column_name
                   ) AS is_primary
            FROM information_schema.columns c
            WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY c.table_schema, c.table_name, c.ordinal_position
          `);
          return result.rows;
        },
        { retryOnNoEncryption: true }
      );
      return rows.filter((r) => !selected.size || selected.has(`${r.schema}.${r.table_name}`.toLowerCase()));
    }

    if (engine === "mysql") {
      const connection = cfg.connectionString
        ? await mysql.createConnection(cfg.connectionString)
        : await mysql.createConnection(cfg);
      const [rows] = await connection.query(`
        SELECT c.TABLE_SCHEMA AS schema,
               c.TABLE_NAME AS table_name,
               c.COLUMN_NAME AS column_name,
               c.DATA_TYPE AS data_type,
               c.IS_NULLABLE AS is_nullable,
               CASE WHEN k.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS is_primary
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
          ON c.TABLE_SCHEMA = k.TABLE_SCHEMA
         AND c.TABLE_NAME = k.TABLE_NAME
         AND c.COLUMN_NAME = k.COLUMN_NAME
         AND k.CONSTRAINT_NAME = 'PRIMARY'
        WHERE c.TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
      `);
      await connection.end();
      return rows.filter((r) => !selected.size || selected.has(`${r.schema}.${r.table_name}`.toLowerCase()));
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
      const result = await pool.request().query(`
        SELECT s.name AS schema,
               t.name AS table_name,
               c.name AS column_name,
               ty.name AS data_type,
               CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS is_nullable,
               CASE WHEN i.is_primary_key = 1 THEN 1 ELSE 0 END AS is_primary
        FROM sys.tables t
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        JOIN sys.columns c ON c.object_id = t.object_id
        JOIN sys.types ty ON c.user_type_id = ty.user_type_id
        LEFT JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.column_id = c.column_id
        LEFT JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND i.is_primary_key = 1
        ORDER BY s.name, t.name, c.column_id
      `);
      await pool.close();
      return result.recordset.filter((r) => !selected.size || selected.has(`${r.schema}.${r.table_name}`.toLowerCase()));
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
  listRelationships,
  listTableColumns,
  runQuery,
  // exported for tests
  shouldRetryPgWithSsl,
  resolveTargetPgSslConfig,
};
