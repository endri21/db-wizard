# DB Wizard (Node + Express + Multi-Page UI)

A multi-database access tool implemented with **Node.js (Express)** and a modern **multi-page web UI**.

## Features

- Multi-page UX: Login page, Dashboard page, and dedicated SQL Workspace page.
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
- Frontend: Multi-page HTML + modern vanilla JavaScript UI served by Express.
- Target query engines: PostgreSQL (`pg`), MySQL (`mysql2`), SQL Server (`mssql`).

## UI Pages

- `/` → Login / Register / OAuth entry
- `/dashboard` → Connection management
- `/workspace/:id` → SQL IDE for one connection

## Run

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`.

## Database init quick note

If you run `npm run db:init` without setting env vars, the app now falls back to:

`postgresql://postgres:postgres@localhost:5432/db_wizard`

You can still override with `APP_DATABASE_URL` or `DATABASE_URL`.

## Database initialization and seed

### Fix for `no pg_hba.conf entry ... no encryption`

That error means your PostgreSQL server accepts SSL connections for your host/user/db, but the client attempted non-SSL.

Set:

```bash
APP_DATABASE_SSLMODE=require
APP_DATABASE_SSL_REJECT_UNAUTHORIZED=false
```

If your server has a trusted CA chain configured, you can harden this with:

```bash
APP_DATABASE_SSLMODE=verify-full
APP_DATABASE_SSL_REJECT_UNAUTHORIZED=true
```

For **dbt** specifically, set in `profiles.yml` under your target:

```yaml
outputs:
  dev:
    type: postgres
    host: <host>
    user: <user>
    password: <password>
    dbname: <dbname>
    schema: public
    port: 5432
    sslmode: require
```

### Fix for `getaddrinfo ENOTFOUND base`

This usually means the **host part** of your connection string is wrong (for example, it resolves to `base` which DNS cannot resolve).

Use the correct connection string format:

- PostgreSQL: `postgresql://user:password@host:5432/database`
- MySQL: `mysql://user:password@host:3306/database`
- MSSQL: `mssql://user:password@host:1433/database`

If you use server fields instead of connection string, make sure `server`, `database_name`, `db_username`, and `db_password` are all filled.

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
