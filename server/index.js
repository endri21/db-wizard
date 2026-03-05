require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const store = require("./store");
const { listTables, listRelationships, listTableColumns, runQuery } = require("./dbClients");
const { ensureReadOnlyQuery } = require("./queryGuard");
const { configurePassport, passport } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

const findUserById = (id) => store.findUserById(id);
const findUserByUsername = (username) => store.findUserByUsername(username);
const findUserByProvider = (provider, providerId) => store.findUserByProvider(provider, providerId);

const upsertOAuthUser = async (provider, providerId, username) => {
  const existing = await findUserByProvider(provider, providerId);
  if (existing) return existing;
  return store.createUser({ username, provider, provider_id: providerId });
};

configurePassport({ upsertOAuthUser, findUserById });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: false },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/client", express.static(path.join(__dirname, "..", "client")));

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  return next();
}

function isAdminUser(user) {
  return String(user?.role || "").toLowerCase() === "admin";
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!isAdminUser(req.user)) return res.status(403).json({ error: "Admin access required." });
  return next();
}

async function getOwnedConnection(connectionId, userId, options = {}) {
  return store.findConnectionByIdAndUser(connectionId, userId, options);
}

async function getOwnedSavedQuery(savedQueryId, connectionId, userId) {
  return store.findSavedQuery(savedQueryId, connectionId, userId);
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "login.html"));
});

app.get("/register", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "register.html"));
});

function requireAuthPage(req, res, next) {
  if (!req.user) {
    return res.redirect("/");
  }
  return next();
}

app.get("/dashboard", requireAuthPage, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "dashboard.html"));
});

app.get("/workspace/:id", requireAuthPage, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "workspace.html"));
});

app.get("/admin", requireAuthPage, (req, res) => {
  return res.redirect("/users");
});

app.get("/users", requireAuthPage, (_req, res) => {
  return res.sendFile(path.join(__dirname, "..", "client", "users.html"));
});

app.get("/roles", requireAuthPage, (_req, res) => {
  return res.sendFile(path.join(__dirname, "..", "client", "roles.html"));
});

app.get("/api/auth/providers", (_req, res) => {
  res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    azure: Boolean(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET),
  });
});

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  if (await findUserByUsername(username)) {
    return res.status(400).json({ error: "Username already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await store.createUser({ username, password_hash: passwordHash, provider: "local" });
  return res.json({ message: "Registration successful." });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await findUserByUsername(username);
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  req.login(user, (err) => {
    if (err) return res.status(500).json({ error: "Login failed." });
    return res.json({ id: user.id, username: user.username });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  return res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      provider: req.user.provider,
      role: req.user.role,
      max_connections: req.user.max_connections,
    },
  });
});

app.post("/api/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: "Logout failed." });
    req.session.destroy(() => res.json({ message: "Logged out" }));
  });
});

const strategies = ["google", "github", "azure"];
strategies.forEach((provider) => {
  app.get(`/auth/${provider}`, (req, res, next) => {
    if (!passport._strategy(provider)) return res.status(400).json({ error: `${provider} OAuth is not configured.` });
    return passport.authenticate(provider)(req, res, next);
  });

  app.get(`/auth/${provider}/callback`, (req, res, next) => {
    if (!passport._strategy(provider)) return res.status(400).json({ error: `${provider} OAuth is not configured.` });
    return passport.authenticate(provider, { failureRedirect: "/?error=oauth" })(req, res, () => {
      res.redirect("/dashboard");
    });
  });
});

app.get("/api/connections", requireAuth, async (req, res) => {
  res.json(await store.listConnectionsByUserId(req.user.id));
});

app.post("/api/connections", requireAuth, async (req, res) => {
  const { name, engine, connection_string, server, port, database_name, db_username, db_password } = req.body;
  if (!name || !engine) return res.status(400).json({ error: "Connection name and engine are required." });

  const currentCount = await store.countConnectionsByUserId(req.user.id);
  const maxAllowed = Number(req.user.max_connections || 5);
  if (currentCount >= maxAllowed) {
    return res.status(400).json({ error: `Maximum connections reached (${maxAllowed}). Contact admin to increase limit.` });
  }

  const conn = await store.createConnection({
    user_id: req.user.id,
    name,
    engine,
    connection_string,
    server,
    port,
    database_name,
    db_username,
    db_password,
  });
  res.json(conn);
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  res.json(await store.listUsersForAdmin());
});

app.put("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const existing = await store.findUserById(req.params.id);
  if (!existing) return res.status(404).json({ error: "User not found." });

  const roleInput = req.body.role;
  const maxInput = req.body.max_connections;

  const role = roleInput == null ? String(existing.role || "user").toLowerCase() : String(roleInput).toLowerCase();
  const max_connections =
    maxInput == null ? Number(existing.max_connections || 5) : Number(maxInput);

  if (!["admin", "user"].includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'user'." });
  if (!Number.isFinite(max_connections) || max_connections < 1 || max_connections > 200) {
    return res.status(400).json({ error: "max_connections must be between 1 and 200." });
  }

  const updated = await store.updateUserAdmin(req.params.id, { role, max_connections });
  if (!updated) return res.status(404).json({ error: "User not found." });
  res.json(updated);
});


app.post("/api/connections/test", requireAuth, async (req, res) => {
  const { name = "test", engine, connection_string, server, port, database_name, db_username, db_password } = req.body;
  if (!engine) return res.status(400).json({ error: "Engine is required for connection test." });

  try {
    const schemas = await listTables({
      name,
      engine,
      connection_string,
      server,
      port,
      database_name,
      db_username,
      db_password,
    });
    const schemaCount = schemas.length;
    const tableCount = schemas.reduce((acc, s) => acc + (s.tables?.length || 0), 0);
    const procCount = schemas.reduce((acc, s) => acc + (s.procedures?.length || 0), 0);
    return res.json({
      ok: true,
      message: `Connection successful. Found ${schemaCount} schema(s), ${tableCount} table(s), ${procCount} procedure(s).`,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.put("/api/connections/:id", requireAuth, async (req, res) => {
  const existing = await getOwnedConnection(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Connection not found." });

  const currentWithSecrets = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });

  const { name, engine, connection_string, server, port, database_name, db_username, db_password } = req.body;
  if (!name || !engine) return res.status(400).json({ error: "Connection name and engine are required." });

  const updated = await store.updateConnection(req.params.id, {
    user_id: req.user.id,
    name,
    engine,
    connection_string: connection_string || currentWithSecrets.connection_string,
    server,
    port,
    database_name,
    db_username,
    db_password: db_password || currentWithSecrets.db_password,
  });

  res.json(updated);
});

app.delete("/api/connections/:id", requireAuth, async (req, res) => {
  const deleted = await store.deleteConnection(req.params.id, req.user.id);
  if (!deleted) return res.status(404).json({ error: "Connection not found." });
  res.json({ message: "Connection deleted." });
});

app.get("/api/connections/:id/status", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  try {
    await listTables(conn);
    return res.json({ connected: true });
  } catch (err) {
    return res.json({ connected: false, error: err.message });
  }
});

app.get("/api/connections/:id/tables", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  try {
    const schemas = await listTables(conn);
    res.json({ schemas });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.post("/api/connections/:id/relationships", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  try {
    const selectedTables = Array.isArray(req.body?.tables) ? req.body.tables : [];
    const relationships = await listRelationships(conn, selectedTables);
    const tableSet = new Set(selectedTables.map((t) => String(t).toLowerCase()));
    relationships.forEach((rel) => {
      tableSet.add(`${rel.from_schema}.${rel.from_table}`.toLowerCase());
      tableSet.add(`${rel.to_schema}.${rel.to_table}`.toLowerCase());
    });
    const tables = Array.from(tableSet);
    const columns = await listTableColumns(conn, tables);
    res.json({ relationships, columns });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/connections/:id/query", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  try {
    const result = await runQuery(conn, req.body.query);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/connections/:id/saved-queries", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  res.json(await store.listSavedQueries(req.user.id, req.params.id));
});

app.post("/api/connections/:id/saved-queries", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  const { name, sql_text } = req.body;
  if (!name || !sql_text) return res.status(400).json({ error: "Query name and SQL text are required." });

  try {
    ensureReadOnlyQuery(sql_text);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const saved = await store.createSavedQuery({
    user_id: req.user.id,
    connection_id: req.params.id,
    name: name.trim(),
    sql_text: sql_text.trim(),
  });
  res.json(saved);
});

app.put("/api/connections/:id/saved-queries/:queryId", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  const existing = await getOwnedSavedQuery(req.params.queryId, req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Saved query not found." });

  const { name, sql_text } = req.body;
  if (!name || !sql_text) return res.status(400).json({ error: "Query name and SQL text are required." });

  try {
    ensureReadOnlyQuery(sql_text);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const saved = await store.updateSavedQuery(req.params.queryId, {
    name: name.trim(),
    sql_text: sql_text.trim(),
  });

  res.json(saved);
});

app.delete("/api/connections/:id/saved-queries/:queryId", requireAuth, async (req, res) => {
  const existing = await getOwnedSavedQuery(req.params.queryId, req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Saved query not found." });

  await store.deleteSavedQuery(req.params.queryId);
  res.json({ message: "Saved query deleted." });
});

app.post("/api/connections/:id/saved-queries/:queryId/run", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  const saved = await getOwnedSavedQuery(req.params.queryId, req.params.id, req.user.id);
  if (!saved) return res.status(404).json({ error: "Saved query not found." });

  try {
    const result = await runQuery(conn, saved.sql_text);
    res.json({ ...result, saved_query: { id: saved.id, name: saved.name } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function start() {
  await store.init();
  app.listen(PORT, () => {
    console.log(`DB Wizard running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start DB Wizard:", err);
  process.exit(1);
});
