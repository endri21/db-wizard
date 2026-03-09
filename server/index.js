require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const store = require("./store");
const { listTables, listRelationships, listTableColumns, runQuery } = require("./dbClients");
const { ensureReadOnlyQuery } = require("./queryGuard");
const { sendInviteEmail, sendEmailConfirmation } = require("./mailer");
const { runSeed } = require("./seed");
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

app.get("/set-password", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "set-password.html"));
});

app.get("/confirm-email", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "confirm-email.html"));
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
  const username = String(req.body?.username || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();
  if (!username || !email || !password) {
    return res.status(400).json({ error: "Username, email, and password are required." });
  }

  if (await findUserByUsername(username)) {
    return res.status(400).json({ error: "Username already exists." });
  }
  if (!(await store.roleExists("basic"))) {
    return res.status(500).json({ error: "Default basic role is missing." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await store.createUser({
    username,
    email,
    email_verified: false,
    password_hash: passwordHash,
    provider: "local",
    role: "basic",
    max_connections: 2,
  });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresHours = Number(process.env.EMAIL_CONFIRM_EXPIRES_HOURS || 24);
  const expiresAt = new Date(Date.now() + Math.max(1, expiresHours) * 60 * 60 * 1000);
  await store.createEmailConfirmToken({ token, user_id: user.id, expires_at: expiresAt.toISOString() });

  const baseUrl = String(process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  const confirmUrl = `${baseUrl}/confirm-email?token=${encodeURIComponent(token)}`;
  const delivery = await sendEmailConfirmation({ to: email, username, confirmUrl, expiresHours });

  return res.json({
    message: "Registration successful. Please confirm your email before login.",
    delivered: Boolean(delivery?.delivered),
    confirmation_url: confirmUrl,
  });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await findUserByUsername(username);
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: "Invalid credentials." });
  }
  if (user.email && !user.email_verified) {
    return res.status(403).json({ error: "Please confirm your email before signing in." });
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

app.get("/api/admin/roles", requireAdmin, async (_req, res) => {
  res.json(await store.listRoles());
});

app.post("/api/admin/roles", requireAdmin, async (req, res) => {
  const name = String(req.body?.name || "").trim().toLowerCase();
  if (!name) return res.status(400).json({ error: "Role name is required." });
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(name)) {
    return res.status(400).json({ error: "Role name must start with a letter and contain only letters, numbers, '_' or '-'." });
  }

  const created = await store.createRole(name);
  if (!created) return res.status(400).json({ error: "Role already exists." });
  res.status(201).json(created);
});

app.put("/api/admin/roles/:name", requireAdmin, async (req, res) => {
  const from = String(req.params.name || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim().toLowerCase();
  if (!name) return res.status(400).json({ error: "Role name is required." });
  if (["admin", "user"].includes(from)) {
    return res.status(400).json({ error: "Default roles cannot be renamed." });
  }
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(name)) {
    return res.status(400).json({ error: "Role name must start with a letter and contain only letters, numbers, '_' or '-'." });
  }

  try {
    const updated = await store.updateRoleName(from, name);
    if (!updated) return res.status(404).json({ error: "Role not found." });
    res.json(updated);
  } catch (err) {
    if (err.code === "ROLE_EXISTS") return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.delete("/api/admin/roles/:name", requireAdmin, async (req, res) => {
  const roleName = String(req.params.name || "").toLowerCase();
  if (["admin", "user"].includes(roleName)) {
    return res.status(400).json({ error: "Default roles cannot be deleted." });
  }

  try {
    const deleted = await store.deleteRole(roleName);
    if (!deleted) return res.status(404).json({ error: "Role not found." });
    return res.json({ message: "Role deleted." });
  } catch (err) {
    if (err.code === "ROLE_IN_USE") return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  res.json(await store.listUsersForAdmin());
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = String(req.body?.role || "user").trim().toLowerCase();
  const max_connections = Number(req.body?.max_connections || 5);
  const shouldSendInvite = req.body?.send_invite !== false;

  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }
  if (!password && !email) {
    return res.status(400).json({ error: "Provide password or email for invite flow." });
  }
  if (!Number.isFinite(max_connections) || max_connections < 1 || max_connections > 200) {
    return res.status(400).json({ error: "max_connections must be between 1 and 200." });
  }
  if (await store.findUserByUsername(username)) {
    return res.status(400).json({ error: "Username already exists." });
  }
  if (!(await store.roleExists(role))) {
    return res.status(400).json({ error: "Selected role does not exist." });
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const user = await store.createUser({
    username,
    email: email || null,
    password_hash: passwordHash,
    provider: "local",
    role,
    max_connections,
  });

  let invitation = null;
  if (!password && email && shouldSendInvite) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresHours = Number(process.env.PASSWORD_SETUP_EXPIRES_HOURS || 24);
    const expiresAt = new Date(Date.now() + Math.max(1, expiresHours) * 60 * 60 * 1000);
    await store.createPasswordSetupToken({ token, user_id: user.id, expires_at: expiresAt.toISOString() });

    const baseUrl = String(process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const setupUrl = `${baseUrl}/set-password?token=${encodeURIComponent(token)}`;
    const delivery = await sendInviteEmail({ to: email, username, setupUrl, expiresHours });
    invitation = {
      setup_url: setupUrl,
      expires_at: expiresAt.toISOString(),
      delivered: Boolean(delivery?.delivered),
      reason: delivery?.reason || null,
    };
  }

  res.status(201).json({
    id: user.id,
    username: user.username,
    email: user.email,
    provider: user.provider,
    role: user.role,
    max_connections: user.max_connections,
    invitation,
  });
});

app.post("/api/password-setup/validate", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "Token is required." });

  const row = await store.findPasswordSetupToken(token);
  if (!row) return res.status(404).json({ error: "Invalid or expired link." });

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await store.deletePasswordSetupToken(token);
    return res.status(410).json({ error: "This link has expired." });
  }

  return res.json({ username: row.username, email: row.email });
});

app.post("/api/password-setup/complete", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "").trim();
  if (!token || !password) {
    return res.status(400).json({ error: "Token and password are required." });
  }

  const row = await store.findPasswordSetupToken(token);
  if (!row) return res.status(404).json({ error: "Invalid or expired link." });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await store.deletePasswordSetupToken(token);
    return res.status(410).json({ error: "This link has expired." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await store.updateUserPassword(row.user_id, passwordHash);
  await store.deletePasswordSetupToken(token);
  return res.json({ message: "Password set successfully. You can now sign in." });
});

app.post("/api/email-confirm/validate", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "Token is required." });

  const row = await store.findEmailConfirmToken(token);
  if (!row) return res.status(404).json({ error: "Invalid or expired confirmation link." });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await store.deleteEmailConfirmToken(token);
    return res.status(410).json({ error: "This confirmation link has expired." });
  }

  return res.json({ username: row.username, email: row.email });
});

app.post("/api/email-confirm/complete", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "Token is required." });

  const row = await store.findEmailConfirmToken(token);
  if (!row) return res.status(404).json({ error: "Invalid or expired confirmation link." });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await store.deleteEmailConfirmToken(token);
    return res.status(410).json({ error: "This confirmation link has expired." });
  }

  await store.verifyUserEmail(row.user_id);
  await store.deleteEmailConfirmToken(token);
  return res.json({ message: "Email confirmed successfully. You can now sign in." });
});

app.put("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const existing = await store.findUserById(req.params.id);
  if (!existing) return res.status(404).json({ error: "User not found." });

  const roleInput = req.body.role;
  const maxInput = req.body.max_connections;

  const role = roleInput == null ? String(existing.role || "user").toLowerCase() : String(roleInput).toLowerCase();
  const max_connections =
    maxInput == null ? Number(existing.max_connections || 5) : Number(maxInput);

  if (!(await store.roleExists(role))) return res.status(400).json({ error: "Selected role does not exist." });
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

app.get("/api/connections/:id/diagrams", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  const diagrams = await store.listSavedDiagrams(req.user.id, req.params.id);
  res.json(diagrams);
});

app.post("/api/connections/:id/diagrams", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  const name = String(req.body?.name || "").trim();
  const diagram_json = req.body?.diagram_json;
  if (!name) return res.status(400).json({ error: "Diagram name is required." });
  if (!diagram_json || typeof diagram_json !== "object") {
    return res.status(400).json({ error: "diagram_json payload is required." });
  }

  const created = await store.createSavedDiagram({
    user_id: req.user.id,
    connection_id: req.params.id,
    name,
    diagram_json,
  });
  res.status(201).json(created);
});

app.get("/api/connections/:id/diagrams/:diagramId", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id, { includeSecrets: true });
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  const diagram = await store.findSavedDiagram(req.params.diagramId, req.params.id, req.user.id);
  if (!diagram) return res.status(404).json({ error: "Diagram not found." });
  res.json(diagram);
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

  const shouldSeedOnStartup = ["true", "1", "yes"].includes(
    String(process.env.SEED_ON_STARTUP || process.env.RUN_DB_SEED || "false").toLowerCase()
  );
  if (shouldSeedOnStartup) {
    console.log("SEED_ON_STARTUP enabled. Running seed before server start...");
    await runSeed({ silent: false });
  }

  app.listen(PORT, () => {
    console.log(`DB Wizard running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start DB Wizard:", err);
  process.exit(1);
});
