require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const cors = require("cors");

const db = require("./store");
const { listTables, runQuery } = require("./dbClients");
const { configurePassport, passport } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

const findUserById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
const findUserByUsername = (username) => db.prepare("SELECT * FROM users WHERE username = ?").get(username);
const findUserByProvider = (provider, providerId) =>
  db.prepare("SELECT * FROM users WHERE provider = ? AND provider_id = ?").get(provider, providerId);

const upsertOAuthUser = (provider, providerId, username) => {
  const existing = findUserByProvider(provider, providerId);
  if (existing) return existing;

  db.prepare("INSERT INTO users (username, provider, provider_id) VALUES (?, ?, ?)").run(username, provider, providerId);
  return findUserByUsername(username);
};

configurePassport({ upsertOAuthUser, findUserById });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: "." }),
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
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
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

  if (findUserByUsername(username)) {
    return res.status(400).json({ error: "Username already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO users (username, password_hash, provider) VALUES (?, ?, 'local')").run(
    username,
    passwordHash
  );
  return res.json({ message: "Registration successful." });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = findUserByUsername(username);
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
  req.logout(() => {
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

app.get("/api/connections", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM db_connections WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
  res.json(rows);
});

app.post("/api/connections", requireAuth, (req, res) => {
  const { name, engine, connection_string, server, port, database_name, db_username, db_password } = req.body;
  if (!name || !engine) return res.status(400).json({ error: "Connection name and engine are required." });

  const result = db
    .prepare(
      `INSERT INTO db_connections
      (user_id, name, engine, connection_string, server, port, database_name, db_username, db_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      name,
      engine,
      connection_string || null,
      server || null,
      port || null,
      database_name || null,
      db_username || null,
      db_password || null
    );

  const conn = db.prepare("SELECT * FROM db_connections WHERE id = ?").get(result.lastInsertRowid);
  res.json(conn);
});

app.get("/api/connections/:id/tables", requireAuth, async (req, res) => {
  const conn = db
    .prepare("SELECT * FROM db_connections WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  try {
    const tables = await listTables(conn);
    res.json({ tables });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/connections/:id/query", requireAuth, async (req, res) => {
  const conn = db
    .prepare("SELECT * FROM db_connections WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!conn) return res.status(404).json({ error: "Connection not found." });

  try {
    const result = await runQuery(conn, req.body.query);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`DB Wizard running on http://localhost:${PORT}`);
});
