const crypto = require("crypto");

const PREFIX = "enc:v1:";

function resolveEncryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.SESSION_SECRET || "local-dev-key-change-me";
  return crypto.createHash("sha256").update(String(raw)).digest();
}

function encryptSecret(value) {
  if (value === null || value === undefined || value === "") return null;
  const iv = crypto.randomBytes(12);
  const key = resolveEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!String(value).startsWith(PREFIX)) {
    return String(value);
  }

  const payload = String(value).slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secret payload.");
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const key = resolveEncryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = {
  encryptSecret,
  decryptSecret,
};
