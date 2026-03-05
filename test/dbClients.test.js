const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldRetryPgWithSsl, resolveTargetPgSslConfig } = require("../server/dbClients");

test("shouldRetryPgWithSsl detects pg_hba no encryption error", () => {
  const err = new Error('no pg_hba.conf entry for host "10.1.1.4", user "u", database "d", no encryption');
  assert.equal(shouldRetryPgWithSsl(err), true);
});

test("resolveTargetPgSslConfig reads TARGET_DB_SSLMODE and rejectUnauthorized", () => {
  process.env.TARGET_DB_SSLMODE = "require";
  process.env.TARGET_DB_SSL_REJECT_UNAUTHORIZED = "false";
  const ssl = resolveTargetPgSslConfig(false);
  assert.deepEqual(ssl, { rejectUnauthorized: false });
});
