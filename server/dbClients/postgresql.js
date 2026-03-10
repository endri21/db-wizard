const { Client } = require("pg");

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
  const runOnce = async (forceSsl) => {
    const client = new Client(buildPgClientConfig(cfg, forceSsl));
    try {
      await client.connect();
      return await runner(client);
    } finally {
      try {
        await client.end();
      } catch {
        // ignore close errors
      }
    }
  };

  try {
    return await runOnce(false);
  } catch (err) {
    if (retryOnNoEncryption && shouldRetryPgWithSsl(err)) {
      return runOnce(true);
    }
    throw err;
  }
}

async function listTables(cfg, formatSchemaTree) {
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

async function listRelationships(cfg, selectedTables = []) {
  const selectedSet = new Set((selectedTables || []).map((t) => String(t).toLowerCase()));
  const includeRel = (row) => {
    if (!selectedSet.size) return true;
    const from = `${row.from_schema}.${row.from_table}`.toLowerCase();
    const to = `${row.to_schema}.${row.to_table}`.toLowerCase();
    return selectedSet.has(from) || selectedSet.has(to);
  };

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

async function listTableColumns(cfg, tables = []) {
  const selected = new Set((tables || []).map((t) => String(t).toLowerCase()));
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

async function runQuery(cfg, query) {
  return withPgClient(
    cfg,
    async (client) => {
      const result = await client.query(query);
      return { columns: result.fields.map((f) => f.name), rows: result.rows.slice(0, 200) };
    },
    { retryOnNoEncryption: true }
  );
}

module.exports = {
  listTables,
  listRelationships,
  listTableColumns,
  runQuery,
  shouldRetryPgWithSsl,
  resolveTargetPgSslConfig,
};
