const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureReadOnlyQuery } = require("../server/queryGuard");

test("allows read-only queries", () => {
  assert.doesNotThrow(() => ensureReadOnlyQuery("SELECT * FROM users"));
  assert.doesNotThrow(() => ensureReadOnlyQuery("with cte as (select 1) select * from cte"));
});

test("blocks mutation queries", () => {
  assert.throws(() => ensureReadOnlyQuery("DELETE FROM users"), /Only read-only queries/);
  assert.throws(() => ensureReadOnlyQuery("UPDATE users SET name='x'"), /Only read-only queries/);
});
