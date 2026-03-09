const { ensureReadOnlyQuery } = require("./queryGuard");
const shared = require("./dbClients/shared");
const pgClient = require("./dbClients/postgresql");
const mySqlClient = require("./dbClients/mysql");
const msSqlClient = require("./dbClients/mssql");

function resolveEngineClient(engine) {
  const normalized = shared.normalizeEngine(engine);
  if (normalized === "postgresql") return pgClient;
  if (normalized === "mysql") return mySqlClient;
  if (normalized === "mssql") return msSqlClient;
  throw new Error(`Unsupported engine: ${engine}. Supported engines: postgresql, mysql, mssql.`);
}

async function listTables(conn) {
  const cfg = shared.buildConfig(conn);
  const engineClient = resolveEngineClient(conn.engine);

  try {
    return await engineClient.listTables(cfg, shared.formatSchemaTree);
  } catch (err) {
    shared.rethrowFriendlyConnectionError(err, cfg, pgClient.shouldRetryPgWithSsl);
  }
}

async function listRelationships(conn, selectedTables = []) {
  const cfg = shared.buildConfig(conn);
  const engineClient = resolveEngineClient(conn.engine);

  try {
    return await engineClient.listRelationships(cfg, selectedTables);
  } catch (err) {
    shared.rethrowFriendlyConnectionError(err, cfg, pgClient.shouldRetryPgWithSsl);
  }
}

async function listTableColumns(conn, tables = []) {
  const cfg = shared.buildConfig(conn);
  const engineClient = resolveEngineClient(conn.engine);

  try {
    return await engineClient.listTableColumns(cfg, tables);
  } catch (err) {
    shared.rethrowFriendlyConnectionError(err, cfg, pgClient.shouldRetryPgWithSsl);
  }
}

async function runQuery(conn, query) {
  ensureReadOnlyQuery(query);
  const cfg = shared.buildConfig(conn);
  const engineClient = resolveEngineClient(conn.engine);

  try {
    return await engineClient.runQuery(cfg, query);
  } catch (err) {
    shared.rethrowFriendlyConnectionError(err, cfg, pgClient.shouldRetryPgWithSsl);
  }
}

module.exports = {
  listTables,
  listRelationships,
  listTableColumns,
  runQuery,
  shouldRetryPgWithSsl: pgClient.shouldRetryPgWithSsl,
  resolveTargetPgSslConfig: pgClient.resolveTargetPgSslConfig,
};
