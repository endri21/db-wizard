async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });

  const contentType = res.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await res.json() : {};

  if (!res.ok) {
    throw new Error(payload.error || `Request failed (${res.status})`);
  }

  return payload;
}

function ensureToastRoot() {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    root.className = "toast-root";
    document.body.appendChild(root);
  }
  return root;
}

function showToast(message, type = "error") {
  if (!message) return;
  const root = ensureToastRoot();
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  root.appendChild(item);

  window.setTimeout(() => item.classList.add("show"), 10);
  window.setTimeout(() => {
    item.classList.remove("show");
    window.setTimeout(() => item.remove(), 250);
  }, 3600);
}

function showError(message) {
  if (message) showToast(message, "error");
}

function showSuccess(message) {
  if (message) showToast(message, "success");
}

async function requireUserOrRedirect() {
  const me = await apiRequest("/api/me");
  if (!me.user) {
    window.location.href = "/";
    return null;
  }
  return me.user;
}
