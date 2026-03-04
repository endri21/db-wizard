async function loadConnections() {
  const connections = await apiRequest("/api/connections");
  const list = document.getElementById("connection-list");
  list.innerHTML = "";

  if (!connections.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No connections yet.";
    list.appendChild(li);
    return;
  }

  connections.forEach((conn) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = `${conn.name} (${conn.engine})`;
    btn.addEventListener("click", () => {
      window.location.href = `/workspace/${conn.id}`;
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

(async function initDashboard() {
  try {
    const user = await requireUserOrRedirect();
    if (!user) return;
    document.getElementById("user-chip").textContent = `Signed in: ${user.username}`;

    document.getElementById("logout-btn").addEventListener("click", async () => {
      await apiRequest("/api/logout", { method: "POST" });
      window.location.href = "/";
    });

    document.getElementById("connection-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("");
      const form = new FormData(e.target);
      try {
        await apiRequest("/api/connections", {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name"),
            engine: form.get("engine"),
            connection_string: form.get("connection_string"),
            server: form.get("server"),
            port: form.get("port"),
            database_name: form.get("database_name"),
            db_username: form.get("db_username"),
            db_password: form.get("db_password"),
          }),
        });
        e.target.reset();
        await loadConnections();
      } catch (err) {
        showError(err.message);
      }
    });

    await loadConnections();
  } catch (err) {
    showError(err.message);
  }
})();
