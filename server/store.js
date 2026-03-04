const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const dbFile = path.join(dataDir, "app-data.json");

const initialState = {
  counters: {
    users: 1,
    db_connections: 1,
    saved_queries: 1,
  },
  users: [],
  db_connections: [],
  saved_queries: [],
};

function nowIso() {
  return new Date().toISOString();
}

function ensureDbFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify(initialState, null, 2));
  }
}

function readState() {
  ensureDbFile();
  const raw = fs.readFileSync(dbFile, "utf8");
  return JSON.parse(raw);
}

function writeState(state) {
  const tmpFile = `${dbFile}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, dbFile);
}

function nextId(state, tableName) {
  const id = state.counters[tableName];
  state.counters[tableName] += 1;
  return id;
}

function findUserById(id) {
  const state = readState();
  return state.users.find((u) => u.id === Number(id)) || null;
}

function findUserByUsername(username) {
  const state = readState();
  return state.users.find((u) => u.username === username) || null;
}

function findUserByProvider(provider, providerId) {
  const state = readState();
  return state.users.find((u) => u.provider === provider && u.provider_id === providerId) || null;
}

function createUser({ username, password_hash = null, provider = "local", provider_id = null }) {
  const state = readState();
  const user = {
    id: nextId(state, "users"),
    username,
    password_hash,
    provider,
    provider_id,
    created_at: nowIso(),
  };
  state.users.push(user);
  writeState(state);
  return user;
}

function listConnectionsByUserId(userId) {
  const state = readState();
  return state.db_connections
    .filter((c) => c.user_id === Number(userId))
    .sort((a, b) => b.id - a.id);
}

function findConnectionByIdAndUser(connectionId, userId) {
  const state = readState();
  return (
    state.db_connections.find((c) => c.id === Number(connectionId) && c.user_id === Number(userId)) || null
  );
}

function createConnection(payload) {
  const state = readState();
  const record = {
    id: nextId(state, "db_connections"),
    user_id: Number(payload.user_id),
    name: payload.name,
    engine: payload.engine,
    connection_string: payload.connection_string || null,
    server: payload.server || null,
    port: payload.port || null,
    database_name: payload.database_name || null,
    db_username: payload.db_username || null,
    db_password: payload.db_password || null,
    created_at: nowIso(),
  };
  state.db_connections.push(record);
  writeState(state);
  return record;
}

function listSavedQueries(userId, connectionId) {
  const state = readState();
  return state.saved_queries
    .filter((q) => q.user_id === Number(userId) && q.connection_id === Number(connectionId))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at) || b.id - a.id);
}

function findSavedQuery(savedQueryId, connectionId, userId) {
  const state = readState();
  return (
    state.saved_queries.find(
      (q) => q.id === Number(savedQueryId) && q.connection_id === Number(connectionId) && q.user_id === Number(userId)
    ) || null
  );
}

function createSavedQuery({ user_id, connection_id, name, sql_text }) {
  const state = readState();
  const ts = nowIso();
  const query = {
    id: nextId(state, "saved_queries"),
    user_id: Number(user_id),
    connection_id: Number(connection_id),
    name,
    sql_text,
    created_at: ts,
    updated_at: ts,
  };
  state.saved_queries.push(query);
  writeState(state);
  return query;
}

function updateSavedQuery(savedQueryId, { name, sql_text }) {
  const state = readState();
  const index = state.saved_queries.findIndex((q) => q.id === Number(savedQueryId));
  if (index === -1) return null;

  state.saved_queries[index] = {
    ...state.saved_queries[index],
    name,
    sql_text,
    updated_at: nowIso(),
  };
  writeState(state);
  return state.saved_queries[index];
}

function deleteSavedQuery(savedQueryId) {
  const state = readState();
  const before = state.saved_queries.length;
  state.saved_queries = state.saved_queries.filter((q) => q.id !== Number(savedQueryId));
  writeState(state);
  return before !== state.saved_queries.length;
}

module.exports = {
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
