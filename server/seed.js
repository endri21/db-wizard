require("dotenv").config();

const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const store = require("./store");

const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("APP_DATABASE_URL (or DATABASE_URL) is required for seeding.");
}

const pool = new Pool({ connectionString });

async function seed() {
  await store.init();

  const username = process.env.SEED_DEMO_USERNAME || "admin";
  const password = process.env.SEED_DEMO_PASSWORD || "admin123";
  const passwordHash = await bcrypt.hash(password, 10);

  const userResult = await pool.query(
    `INSERT INTO users (username, password_hash, provider)
     VALUES ($1, $2, 'local')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, username`,
    [username, passwordHash]
  );

  const user = userResult.rows[0];

  const existingConn = await pool.query(
    `SELECT id FROM db_connections WHERE user_id = $1 AND name = $2 LIMIT 1`,
    [user.id, "Demo PostgreSQL"]
  );

  let connectionId;
  if (existingConn.rows[0]) {
    connectionId = existingConn.rows[0].id;
  } else {
    const connResult = await pool.query(
      `INSERT INTO db_connections (user_id, name, engine, connection_string)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [user.id, "Demo PostgreSQL", "postgresql", connectionString]
    );
    connectionId = connResult.rows[0].id;
  }

  const existingQuery = await pool.query(
    `SELECT id FROM saved_queries WHERE user_id = $1 AND connection_id = $2 AND name = $3 LIMIT 1`,
    [user.id, connectionId, "Health Check"]
  );

  if (!existingQuery.rows[0]) {
    await pool.query(
      `INSERT INTO saved_queries (user_id, connection_id, name, sql_text)
       VALUES ($1, $2, $3, $4)`,
      [user.id, connectionId, "Health Check", "SELECT NOW() AS server_time;"]
    );
  }

  console.log("Seed completed successfully.");
  console.log(`Demo user: ${username}`);
  console.log(`Demo password: ${password}`);
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
