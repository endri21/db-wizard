const test = require("node:test");
const assert = require("node:assert/strict");

process.env.APP_ENCRYPTION_KEY = "unit-test-secret-key";

const { encryptSecret, decryptSecret } = require("../server/crypto");

test("encryptSecret stores cipher text and decryptSecret restores original", () => {
  const plain = "p@ssw0rd!";
  const encrypted = encryptSecret(plain);

  assert.ok(encrypted.startsWith("enc:v1:"));
  assert.notEqual(encrypted, plain);
  assert.equal(decryptSecret(encrypted), plain);
});

test("decryptSecret supports legacy plain text values", () => {
  assert.equal(decryptSecret("legacy-plain-value"), "legacy-plain-value");
});
