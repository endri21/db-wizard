let editingConnectionId = null;
let latestConnections = [];

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

function resetConnectionForm() {
  editingConnectionId = null;
  document.getElementById("connection-form").reset();
  document.getElementById("connection-modal-title").textContent = "Add Database Connection";
  document.getElementById("connection-submit-btn").textContent = "Save Connection";
}

function startEditConnection(conn) {
  editingConnectionId = conn.id;
  const form = document.getElementById("connection-form");
  form.elements.name.value = conn.name || "";
  form.elements.engine.value = conn.engine || "postgresql";
  form.elements.connection_string.value = "";
  form.elements.server.value = conn.server || "";
  form.elements.port.value = conn.port || "";
  form.elements.database_name.value = conn.database_name || "";
  form.elements.db_username.value = conn.db_username || "";
  form.elements.db_password.value = "";

  document.getElementById("connection-modal-title").textContent = "Edit Database Connection";
  document.getElementById("connection-submit-btn").textContent = "Update Connection";
  openModal();
}

async function loadConnections() {
  const connections = await apiRequest("/api/connections");
  latestConnections = connections;

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
      : "Using server credentials";

    const actions = document.createElement("div");
    actions.className = "actions-row";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open Workspace";
    openBtn.addEventListener("click", () => {
      window.location.href = `/workspace/${conn.id}`;
    });

    const editBtn = document.createElement("button");
    editBtn.className = "secondary";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditConnection(conn));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      try {
        await apiRequest(`/api/connections/${conn.id}`, { method: "DELETE" });
        showSuccess("Workspace deleted.");
        await loadConnections();
      } catch (err) {
        showError(err.message);
      }
    });

    actions.append(openBtn, editBtn, deleteBtn);
    li.append(top, details, actions);
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

    document.getElementById("open-connection-modal-btn").addEventListener("click", () => {
      resetConnectionForm();
      openModal();
    });
    document.getElementById("close-connection-modal-btn").addEventListener("click", () => {
      closeModal();
      resetConnectionForm();
    });

    document.getElementById("connection-modal").addEventListener("click", (e) => {
      if (e.target.id === "connection-modal") {
        closeModal();
        resetConnectionForm();
      }
    });

    document.getElementById("connection-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const payload = {
        name: form.get("name"),
        engine: form.get("engine"),
        connection_string: form.get("connection_string"),
        server: form.get("server"),
        port: form.get("port"),
        database_name: form.get("database_name"),
        db_username: form.get("db_username"),
        db_password: form.get("db_password"),
      };

      try {
        if (editingConnectionId) {
          await apiRequest(`/api/connections/${editingConnectionId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          showSuccess("Workspace updated.");
        } else {
          await apiRequest("/api/connections", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          showSuccess("Workspace created.");
        }

        closeModal();
        resetConnectionForm();
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
