# DB Wizard (Node + Express + Multi-Page UI)

A multi-database access tool implemented with **Node.js (Express)** and a modern **multi-page web UI**.

## Features

- Multi-page UX: Login page, Dashboard page, and dedicated SQL Workspace page.
- Login with username/password.
- Organization login with OAuth providers: Google, GitHub, Azure (when configured).
- Management dashboard to add connections using:
  - full connection string, or
  - server + port + db + username + password.
- Connection secrets are encrypted at rest (AES-256-GCM) before saving to PostgreSQL.
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


## Connection secret encryption

Database connection secrets (`connection_string`, `db_password`) are encrypted before writing to app metadata storage.

Configure in `.env`:

```bash
APP_ENCRYPTION_KEY=your-long-random-secret
```

If omitted, the app falls back to `SESSION_SECRET` (or a local dev fallback), but setting a dedicated strong key is recommended for production.

## Tech Stack

- Backend: Node.js + Express + Passport + PostgreSQL (`pg`) for app persistence.
- Frontend: Multi-page HTML + modern vanilla JavaScript UI served by Express.
- Target query engines: PostgreSQL (`pg`), MySQL (`mysql2`), SQL Server (`mssql`).

## UI Pages

- `/` → Login / Register / OAuth entry
- `/dashboard` → Connection management
- `/workspace/:id` → SQL IDE for one connection
- `/set-password?token=...` → Password setup page for invited users
- `/confirm-email?token=...` → Email confirmation page for self-registration

## Admin invite flow (email + user-defined password)

- Admin can create a local user with **email** and no initial password.
- Server creates a one-time password setup token and builds a setup URL.
- The app can send invite emails by POSTing payloads to `EMAIL_DELIVERY_WEBHOOK_URL`.
- If no webhook is configured, the API still returns the setup URL so admin can share it manually.

Related env vars:

- `APP_BASE_URL` (used to build setup links)
- `EMAIL_DELIVERY_WEBHOOK_URL`
- `EMAIL_FROM`
- `PASSWORD_SETUP_EXPIRES_HOURS`

### SMTP support (Exchange / Gmail)

DB Wizard supports direct SMTP delivery in addition to webhook delivery.

Use these env vars:

- `EMAIL_USE_SMTP=true` (default)
- `SMTP_HOST`
- `SMTP_PORT` (587 for STARTTLS or 465 for implicit TLS)
- `SMTP_SECURE` (`true` for 465)
- `SMTP_REQUIRE_TLS`
- `SMTP_TLS_REJECT_UNAUTHORIZED`
- `SMTP_USER`
- `SMTP_PASS`

If SMTP is configured, email sends through SMTP first (default). If SMTP is not configured or disabled, webhook delivery is used as fallback.

## Self registration email confirmation

- Self-registration now requires **username + email + password**.
- New self-registered users are created with role **basic** and limited to **2** DB connections.
- User must confirm email via the received link before login is allowed.
- Confirmation expiry is controlled by `EMAIL_CONFIRM_EXPIRES_HOURS`.

## Admin invite links for users that do not yet exist

- Admin can send an invite link to an email address via `/api/admin/invites`.
- The invited person opens `/register?invite=<token>` and completes account creation.
- Invite tokens expire in **30 minutes** by default (config: `USER_INVITE_EXPIRES_MINUTES`).

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

For deployment/startup auto-seeding by the application itself, set:

```bash
SEED_ON_STARTUP=true
```

When enabled, `server/index.js` runs `store.init()` then executes the seed flow before opening the HTTP port.

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

Additional seeded users (for admin/role testing) are supported:

- `SEED_ANALYST_USERNAME` / `SEED_ANALYST_PASSWORD` (default role `user`, max connections `10`)
- `SEED_VIEWER_USERNAME` / `SEED_VIEWER_PASSWORD` (default role `user`, max connections `3`)

You can fully override seeded users/roles/limits with JSON:

```bash
SEED_USERS_JSON=[{"username":"admin","password":"admin123","role":"admin","max_connections":50},{"username":"analyst","password":"analyst123","role":"user","max_connections":10}]
```


### Target database SSL (for workspace connections)

If your target PostgreSQL server requires TLS (for example error contains `no pg_hba.conf entry ... no encryption`), configure:

```bash
TARGET_DB_SSLMODE=require
TARGET_DB_SSL_REJECT_UNAUTHORIZED=false
```

The app now retries PostgreSQL workspace connections with SSL automatically when it detects that exact `no encryption` failure.


## Run with Docker

You can run DB Wizard directly from the included Dockerfile.

1. Build image:

```bash
docker build -t db-wizard .
```

2. Run container (replace DB URL and secrets):

```bash
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e SESSION_SECRET=change-me \
  -e APP_ENCRYPTION_KEY=change-me-too \
  -e APP_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/db_wizard \
  -e APP_DATABASE_SSLMODE=disable \
  db-wizard
```

Optional seed on startup:

```bash
docker run --rm -p 3000:3000 \
  -e APP_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/db_wizard \
  -e SESSION_SECRET=change-me \
  -e APP_ENCRYPTION_KEY=change-me-too \
  -e RUN_DB_SEED=true \
  db-wizard
```

The container entrypoint automatically runs DB schema initialization before launching the app.

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
