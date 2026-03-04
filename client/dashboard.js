function setDashboardStats(connections) {
  const total = connections.length;
  const engines = new Set(connections.map((c) => c.engine)).size;

  document.getElementById("total-connections").textContent = String(total);
  document.getElementById("engines-used").textContent = String(engines);
}

function openModal() {
  document.getElementById("connection-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("connection-modal").classList.add("hidden");
}

async function loadConnections() {
  const connections = await apiRequest("/api/connections");
  const list = document.getElementById("connection-list");
  list.innerHTML = "";
  setDashboardStats(connections);

  if (!connections.length) {
    const li = document.createElement("li");
    li.className = "panel muted";
    li.textContent = "No databases connected yet. Use '+ Add Connection' to get started.";
    list.appendChild(li);
    return;
  }

  connections.forEach((conn) => {
    const li = document.createElement("li");
    li.className = "resource-card";

    const top = document.createElement("div");
    top.className = "resource-card-top";

    const title = document.createElement("h3");
    title.textContent = conn.name;

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = conn.engine.toUpperCase();

    top.append(title, chip);

    const details = document.createElement("p");
    details.className = "muted";
    details.textContent = conn.database_name
      ? `Database: ${conn.database_name}`
      : conn.connection_string
      ? "Using connection string"
      : "Using server credentials";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open Workspace";
    openBtn.addEventListener("click", () => {
      window.location.href = `/workspace/${conn.id}`;
    });

    li.append(top, details, openBtn);
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

    document.getElementById("open-connection-modal-btn").addEventListener("click", openModal);
    document.getElementById("close-connection-modal-btn").addEventListener("click", closeModal);
    document.getElementById("connection-modal").addEventListener("click", (e) => {
      if (e.target.id === "connection-modal") closeModal();
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
        closeModal();
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
