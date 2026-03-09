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

function rethrowFriendlyConnectionError(err, cfg, shouldRetryPgWithSsl) {
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

module.exports = {
  normalizeEngine,
  normalizeConnectionString,
  buildConfig,
  formatSchemaTree,
  rethrowFriendlyConnectionError,
};
