const READ_ONLY = ["select", "show", "describe", "pragma", "with"];

function ensureReadOnlyQuery(query) {
  const normalized = String(query || "")
    .trim()
    .replace(/^\(+/, "")
    .toLowerCase();

  if (!normalized) {
    throw new Error("Query is required.");
  }

  if (!READ_ONLY.some((cmd) => normalized.startsWith(cmd))) {
    throw new Error("Only read-only queries are allowed (SELECT/SHOW/DESCRIBE/PRAGMA/WITH).");
  }
}

module.exports = { ensureReadOnlyQuery };
