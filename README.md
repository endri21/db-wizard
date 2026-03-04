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
- Advanced SQL IDE basics:
  - save queries per connection,
  - list saved queries,
  - load a saved query into editor,
  - update saved query,
  - delete saved query,
  - run saved query directly.

## What database stores app users and metadata?

The app now stores users, sessions metadata, saved connections, and saved queries in **PostgreSQL**.

Set `APP_DATABASE_URL` in `.env`:

```bash
APP_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/db_wizard
```

On startup, the server auto-creates required tables if they do not exist.

## Tech Stack

- Backend: Node.js + Express + Passport + PostgreSQL (`pg`) for app persistence.
- Frontend: React (CDN) single-page UI.
- Target query engines: PostgreSQL (`pg`), MySQL (`mysql2`), SQL Server (`mssql`).

## Run

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`.


## Database initialization and seed

1. Create a PostgreSQL database (example):

```bash
createdb db_wizard
```

2. Initialize tables:

```bash
npm run db:init
```

3. Seed demo data (user + sample connection + sample saved query):

```bash
npm run db:seed
```

Default demo credentials are controlled by:

- `SEED_DEMO_USERNAME`
- `SEED_DEMO_PASSWORD`

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
