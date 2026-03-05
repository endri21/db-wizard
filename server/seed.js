require("dotenv").config();

const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const store = require("./store");

const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/db_wizard";

const sslMode = String(process.env.APP_DATABASE_SSLMODE || "").toLowerCase();
const sslEnabled = ["require", "verify-ca", "verify-full", "true", "1"].includes(sslMode);
const ssl = sslEnabled
  ? {
      rejectUnauthorized:
        String(process.env.APP_DATABASE_SSL_REJECT_UNAUTHORIZED || "false").toLowerCase() === "true",
    }
  : undefined;

const pool = new Pool({ connectionString, ssl });

function defaultSeedUsers() {
  return [
    {
      username: process.env.SEED_DEMO_USERNAME || "admin",
      password: process.env.SEED_DEMO_PASSWORD || "admin123",
      role: "admin",
      max_connections: 50,
    },
    {
      username: process.env.SEED_ANALYST_USERNAME || "analyst",
      password: process.env.SEED_ANALYST_PASSWORD || "analyst123",
      role: "user",
      max_connections: 10,
    },
    {
      username: process.env.SEED_VIEWER_USERNAME || "viewer",
      password: process.env.SEED_VIEWER_PASSWORD || "viewer123",
      role: "user",
      max_connections: 3,
    },
  ];
}

function readSeedUsers() {
  const raw = process.env.SEED_USERS_JSON;
  if (!raw) return defaultSeedUsers();

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return defaultSeedUsers();
    return parsed;
  } catch {
    return defaultSeedUsers();
  }
}

async function upsertLocalUser(user) {
  const username = String(user.username || "").trim();
  const password = String(user.password || "").trim();
  const role = String(user.role || "user").toLowerCase() === "admin" ? "admin" : "user";
  const maxConnections = Number.isFinite(Number(user.max_connections))
    ? Math.max(1, Math.min(200, Number(user.max_connections)))
    : 5;

  if (!username || !password) return null;

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (username, password_hash, provider, role, max_connections)
     VALUES ($1, $2, 'local', $3, $4)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           max_connections = EXCLUDED.max_connections
     RETURNING id, username, role, max_connections`,
    [username, passwordHash, role, maxConnections]
  );

  return {
    ...result.rows[0],
    plain_password: password,
  };
}

async function seed() {
  await store.init();

  const seededUsers = [];
  for (const userSpec of readSeedUsers()) {
    const seeded = await upsertLocalUser(userSpec);
    if (seeded) seededUsers.push(seeded);
  }

  if (!seededUsers.length) {
    throw new Error("No valid seed users were provided. Check SEED_USERS_JSON or default SEED_* env vars.");
  }

  const adminUser = seededUsers.find((u) => u.role === "admin") || seededUsers[0];

  const existingConn = await pool.query(
    `SELECT id FROM db_connections WHERE user_id = $1 AND name = $2 LIMIT 1`,
    [adminUser.id, "Demo PostgreSQL"]
  );

  let connectionId;
  if (existingConn.rows[0]) {
    connectionId = existingConn.rows[0].id;
  } else {
    const connResult = await pool.query(
      `INSERT INTO db_connections (user_id, name, engine, connection_string)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [adminUser.id, "Demo PostgreSQL", "postgresql", connectionString]
    );
    connectionId = connResult.rows[0].id;
  }

  const existingQuery = await pool.query(
    `SELECT id FROM saved_queries WHERE user_id = $1 AND connection_id = $2 AND name = $3 LIMIT 1`,
    [adminUser.id, connectionId, "Health Check"]
  );

  if (!existingQuery.rows[0]) {
    await pool.query(
      `INSERT INTO saved_queries (user_id, connection_id, name, sql_text)
       VALUES ($1, $2, $3, $4)`,
      [adminUser.id, connectionId, "Health Check", "SELECT NOW() AS server_time;"]
    );
  }

  console.log("Seed completed successfully.");
  seededUsers.forEach((u) => {
    console.log(`Seeded user: ${u.username} | role=${u.role} | max_connections=${u.max_connections} | password=${u.plain_password}`);
  });
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
