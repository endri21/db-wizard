require("dotenv").config();

const { Pool } = require("pg");
const { encryptSecret, decryptSecret } = require("./crypto");

function resolveConnectionString() {
  return (
    process.env.APP_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/db_wizard"
  );
}

function resolveSslConfig() {
  const sslMode = String(process.env.APP_DATABASE_SSLMODE || "").toLowerCase();
  const sslEnabled = ["require", "verify-ca", "verify-full", "true", "1"].includes(sslMode);
  if (!sslEnabled) {
    return undefined;
  }

  const rejectUnauthorized =
    String(process.env.APP_DATABASE_SSL_REJECT_UNAUTHORIZED || "false").toLowerCase() === "true";

  return { rejectUnauthorized };
}

function toPublicConnection(row) {
  if (!row) return null;
  const { connection_string, db_password, ...rest } = row;
  return rest;
}

function toInternalConnection(row) {
  if (!row) return null;
  return {
    ...row,
    connection_string: decryptSecret(row.connection_string),
    db_password: decryptSecret(row.db_password),
  };
}

let pool;

function getPool() {
  if (!pool) {
    const connectionString = resolveConnectionString();
    const ssl = resolveSslConfig();
    if (!connectionString) {
      throw new Error(
        "APP_DATABASE_URL (or DATABASE_URL) is required for app persistence. Set it in .env or shell env."
      );
    }
    pool = new Pool({ connectionString, ssl });
  }
  return pool;
}

async function init() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS db_connections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      engine TEXT NOT NULL,
      connection_string TEXT,
      server TEXT,
      port TEXT,
      database_name TEXT,
      db_username TEXT,
      db_password TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS saved_queries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id INTEGER NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sql_text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function findUserById(id) {
  const { rows } = await getPool().query("SELECT * FROM users WHERE id = $1", [Number(id)]);
  return rows[0] || null;
}

async function findUserByUsername(username) {
  const { rows } = await getPool().query("SELECT * FROM users WHERE username = $1", [username]);
  return rows[0] || null;
}

async function findUserByProvider(provider, providerId) {
  const { rows } = await getPool().query("SELECT * FROM users WHERE provider = $1 AND provider_id = $2", [provider, providerId]);
  return rows[0] || null;
}

async function createUser({ username, password_hash = null, provider = "local", provider_id = null }) {
  const { rows } = await getPool().query(
    `INSERT INTO users (username, password_hash, provider, provider_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [username, password_hash, provider, provider_id]
  );
  return rows[0];
}

async function listConnectionsByUserId(userId) {
  const { rows } = await getPool().query(
    "SELECT * FROM db_connections WHERE user_id = $1 ORDER BY id DESC",
    [Number(userId)]
  );
  return rows.map(toPublicConnection);
}

async function findConnectionByIdAndUser(connectionId, userId, options = {}) {
  const { rows } = await getPool().query(
    "SELECT * FROM db_connections WHERE id = $1 AND user_id = $2",
    [Number(connectionId), Number(userId)]
  );
  const row = rows[0] || null;
  if (!row) return null;
  if (options.includeSecrets) return toInternalConnection(row);
  return toPublicConnection(row);
}

async function createConnection(payload) {
  const { rows } = await getPool().query(
    `INSERT INTO db_connections (
      user_id, name, engine, connection_string, server, port, database_name, db_username, db_password
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      Number(payload.user_id),
      payload.name,
      payload.engine,
      encryptSecret(payload.connection_string || null),
      payload.server || null,
      payload.port || null,
      payload.database_name || null,
      payload.db_username || null,
      encryptSecret(payload.db_password || null),
    ]
  );
  return toPublicConnection(rows[0]);
}

async function listSavedQueries(userId, connectionId) {
  const { rows } = await getPool().query(
    `SELECT * FROM saved_queries
     WHERE user_id = $1 AND connection_id = $2
     ORDER BY updated_at DESC, id DESC`,
    [Number(userId), Number(connectionId)]
  );
  return rows;
}

async function findSavedQuery(savedQueryId, connectionId, userId) {
  const { rows } = await getPool().query(
    `SELECT * FROM saved_queries
     WHERE id = $1 AND connection_id = $2 AND user_id = $3`,
    [Number(savedQueryId), Number(connectionId), Number(userId)]
  );
  return rows[0] || null;
}

async function createSavedQuery({ user_id, connection_id, name, sql_text }) {
  const { rows } = await getPool().query(
    `INSERT INTO saved_queries (user_id, connection_id, name, sql_text)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [Number(user_id), Number(connection_id), name, sql_text]
  );
  return rows[0];
}

async function updateSavedQuery(savedQueryId, { name, sql_text }) {
  const { rows } = await getPool().query(
    `UPDATE saved_queries
     SET name = $1, sql_text = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [name, sql_text, Number(savedQueryId)]
  );
  return rows[0] || null;
}

async function deleteSavedQuery(savedQueryId) {
  const result = await getPool().query("DELETE FROM saved_queries WHERE id = $1", [Number(savedQueryId)]);
  return result.rowCount > 0;
}

module.exports = {
  init,
  findUserById,
  findUserByUsername,
  findUserByProvider,
  createUser,
  listConnectionsByUserId,
  findConnectionByIdAndUser,
  createConnection,
  listSavedQueries,
  findSavedQuery,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
};
