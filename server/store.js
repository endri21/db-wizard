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
  if (!sslEnabled) return undefined;

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
      role TEXT NOT NULL DEFAULT 'user',
      max_connections INTEGER NOT NULL DEFAULT 5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS roles (
      name TEXT PRIMARY KEY,
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

    CREATE TABLE IF NOT EXISTS saved_diagrams (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id INTEGER NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      diagram_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS max_connections INTEGER NOT NULL DEFAULT 5;

    INSERT INTO roles (name) VALUES ('admin') ON CONFLICT (name) DO NOTHING;
    INSERT INTO roles (name) VALUES ('user') ON CONFLICT (name) DO NOTHING;
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

async function createUser({ username, password_hash = null, provider = "local", provider_id = null, role = "user", max_connections = 5 }) {
  const { rows } = await getPool().query(
    `INSERT INTO users (username, password_hash, provider, provider_id, role, max_connections)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [username, password_hash, provider, provider_id, String(role || "user").toLowerCase(), Number(max_connections)]
  );
  return rows[0];
}

async function listRoles() {
  const { rows } = await getPool().query(
    `SELECT r.name, r.created_at,
            COUNT(u.id)::int AS user_count
     FROM roles r
     LEFT JOIN users u ON lower(u.role) = lower(r.name)
     GROUP BY r.name, r.created_at
     ORDER BY r.name ASC`
  );
  return rows;
}

async function roleExists(name) {
  const { rows } = await getPool().query("SELECT 1 FROM roles WHERE lower(name)=lower($1) LIMIT 1", [name]);
  return Boolean(rows[0]);
}

async function createRole(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const { rows } = await getPool().query(
    `INSERT INTO roles (name) VALUES ($1)
     ON CONFLICT (name) DO NOTHING
     RETURNING name, created_at`,
    [normalized]
  );
  return rows[0] || null;
}

async function updateRoleName(oldName, newName) {
  const from = String(oldName || "").trim().toLowerCase();
  const to = String(newName || "").trim().toLowerCase();
  if (!from || !to) return null;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const oldRole = await client.query("SELECT name FROM roles WHERE lower(name)=lower($1) LIMIT 1", [from]);
    if (!oldRole.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    const conflict = await client.query("SELECT 1 FROM roles WHERE lower(name)=lower($1) LIMIT 1", [to]);
    if (conflict.rows[0] && from !== to) {
      const err = new Error("Role already exists.");
      err.code = "ROLE_EXISTS";
      throw err;
    }

    if (from !== to) {
      await client.query("UPDATE users SET role = $1 WHERE lower(role)=lower($2)", [to, from]);
      await client.query("UPDATE roles SET name = $1 WHERE lower(name)=lower($2)", [to, from]);
    }

    await client.query("COMMIT");
    return { name: to };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function deleteRole(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const used = await getPool().query("SELECT COUNT(*)::int AS total FROM users WHERE lower(role)=lower($1)", [normalized]);
  if ((used.rows[0]?.total || 0) > 0) {
    const err = new Error("Role is assigned to existing users.");
    err.code = "ROLE_IN_USE";
    throw err;
  }
  const result = await getPool().query("DELETE FROM roles WHERE lower(name)=lower($1)", [normalized]);
  return result.rowCount > 0;
}

async function listConnectionsByUserId(userId) {
  const { rows } = await getPool().query(
    "SELECT * FROM db_connections WHERE user_id = $1 ORDER BY id DESC",
    [Number(userId)]
  );
  return rows.map(toPublicConnection);
}

async function countConnectionsByUserId(userId) {
  const { rows } = await getPool().query("SELECT COUNT(*)::int AS total FROM db_connections WHERE user_id = $1", [
    Number(userId),
  ]);
  return rows[0]?.total || 0;
}

async function listUsersForAdmin() {
  const { rows } = await getPool().query(
    `SELECT u.id, u.username, u.provider, u.role, u.max_connections, u.created_at,
            COUNT(c.id)::int AS connection_count
     FROM users u
     LEFT JOIN db_connections c ON c.user_id = u.id
     GROUP BY u.id
     ORDER BY u.id ASC`
  );
  return rows;
}

async function updateUserAdmin(userId, { role, max_connections }) {
  const { rows } = await getPool().query(
    `UPDATE users
     SET role = $1,
         max_connections = $2
     WHERE id = $3
     RETURNING id, username, provider, role, max_connections, created_at`,
    [String(role || "user").toLowerCase(), Number(max_connections), Number(userId)]
  );
  return rows[0] || null;
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

async function updateConnection(connectionId, payload) {
  const { rows } = await getPool().query(
    `UPDATE db_connections
     SET name = $1,
         engine = $2,
         connection_string = $3,
         server = $4,
         port = $5,
         database_name = $6,
         db_username = $7,
         db_password = $8
     WHERE id = $9 AND user_id = $10
     RETURNING *`,
    [
      payload.name,
      payload.engine,
      encryptSecret(payload.connection_string || null),
      payload.server || null,
      payload.port || null,
      payload.database_name || null,
      payload.db_username || null,
      encryptSecret(payload.db_password || null),
      Number(connectionId),
      Number(payload.user_id),
    ]
  );
  return rows[0] ? toPublicConnection(rows[0]) : null;
}

async function deleteConnection(connectionId, userId) {
  const result = await getPool().query(
    "DELETE FROM db_connections WHERE id = $1 AND user_id = $2",
    [Number(connectionId), Number(userId)]
  );
  return result.rowCount > 0;
}


async function listSavedDiagrams(userId, connectionId) {
  const { rows } = await getPool().query(
    `SELECT id, user_id, connection_id, name, diagram_json, created_at, updated_at
     FROM saved_diagrams
     WHERE user_id = $1 AND connection_id = $2
     ORDER BY updated_at DESC, id DESC`,
    [Number(userId), Number(connectionId)]
  );
  return rows;
}

async function findSavedDiagram(diagramId, connectionId, userId) {
  const { rows } = await getPool().query(
    `SELECT id, user_id, connection_id, name, diagram_json, created_at, updated_at
     FROM saved_diagrams
     WHERE id = $1 AND connection_id = $2 AND user_id = $3`,
    [Number(diagramId), Number(connectionId), Number(userId)]
  );
  return rows[0] || null;
}

async function createSavedDiagram({ user_id, connection_id, name, diagram_json }) {
  const { rows } = await getPool().query(
    `INSERT INTO saved_diagrams (user_id, connection_id, name, diagram_json)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, user_id, connection_id, name, diagram_json, created_at, updated_at`,
    [Number(user_id), Number(connection_id), name, JSON.stringify(diagram_json)]
  );
  return rows[0];
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
  listRoles,
  roleExists,
  createRole,
  updateRoleName,
  deleteRole,
  listConnectionsByUserId,
  countConnectionsByUserId,
  findConnectionByIdAndUser,
  createConnection,
  updateConnection,
  deleteConnection,
  listSavedDiagrams,
  findSavedDiagram,
  createSavedDiagram,
  listSavedQueries,
  findSavedQuery,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
  listUsersForAdmin,
  updateUserAdmin,
};
