const Database = require("better-sqlite3");

const db = new Database("app.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  provider TEXT DEFAULT 'local',
  provider_id TEXT
);

CREATE TABLE IF NOT EXISTS db_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  engine TEXT NOT NULL,
  connection_string TEXT,
  server TEXT,
  port TEXT,
  database_name TEXT,
  db_username TEXT,
  db_password TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

module.exports = db;
