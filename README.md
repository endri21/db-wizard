# DB Wizard (Node + React)

A multi-database access tool implemented with **Node.js (Express)** and **React**.

## Features

- Login with username/password.
- Organization login with OAuth providers: Google, GitHub, Azure (when configured).
- Management dashboard to add connections using:
  - full connection string, or
  - server + port + db + username + password.
- Explore selected database tables in the left sidebar.
- Run simple read-only queries and view results.

## Tech Stack

- Backend: Node.js + Express + Passport + SQLite store.
- Frontend: React (CDN) single-page UI.
- Database clients: PostgreSQL (`pg`), MySQL (`mysql2`), SQL Server (`mssql`), SQLite (`better-sqlite3`).

## Run

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`.

## OAuth Setup

Configure any provider in `.env`:

- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`
- Azure: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_CALLBACK_URL`, `AZURE_TENANT`

If not configured, provider buttons do not appear in the UI.

## Safety guard

Only read-only queries are allowed:

- `SELECT`
- `SHOW`
- `DESCRIBE`
- `PRAGMA`
- `WITH ... SELECT`

Response rows are limited to 200 per request.
