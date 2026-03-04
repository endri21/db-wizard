require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const store = require("./store");
const { listTables, runQuery } = require("./dbClients");
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

async function getOwnedConnection(connectionId, userId) {
  return store.findConnectionByIdAndUser(connectionId, userId);
}

async function getOwnedSavedQuery(savedQueryId, connectionId, userId) {
  return store.findSavedQuery(savedQueryId, connectionId, userId);
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "index.html"));
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
  return res.json({ user: { id: req.user.id, username: req.user.username, provider: req.user.provider } });
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
      res.redirect("/");
    });
  });
});

app.get("/api/connections", requireAuth, async (req, res) => {
  res.json(await store.listConnectionsByUserId(req.user.id));
});

app.post("/api/connections", requireAuth, async (req, res) => {
  const { name, engine, connection_string, server, port, database_name, db_username, db_password } = req.body;
  if (!name || !engine) return res.status(400).json({ error: "Connection name and engine are required." });

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

app.get("/api/connections/:id/tables", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id);
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  try {
    const tables = await listTables(conn);
    res.json({ tables });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/connections/:id/query", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id);
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  try {
    const result = await runQuery(conn, req.body.query);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/connections/:id/saved-queries", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id);
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  res.json(await store.listSavedQueries(req.user.id, req.params.id));
});

app.post("/api/connections/:id/saved-queries", requireAuth, async (req, res) => {
  const conn = await getOwnedConnection(req.params.id, req.user.id);
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
  const conn = await getOwnedConnection(req.params.id, req.user.id);
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
  const conn = await getOwnedConnection(req.params.id, req.user.id);
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
