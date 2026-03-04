let editingConnectionId = null;

function setDashboardStats(connections) {
  document.title = `DB Wizard | Dashboard (${connections.length})`;
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

function getPayloadFromForm() {
  const form = new FormData(document.getElementById("connection-form"));
  return {
    name: form.get("name"),
    engine: form.get("engine"),
    connection_string: form.get("connection_string"),
    server: form.get("server"),
    port: form.get("port"),
    database_name: form.get("database_name"),
    db_username: form.get("db_username"),
    db_password: form.get("db_password"),
  };
}

function statusCell(status) {
  const wrap = document.createElement("div");
  wrap.className = "status-wrap";
  const dot = document.createElement("span");
  dot.className = `status-dot ${status.connected ? "ok" : "bad"}`;
  const txt = document.createElement("span");
  txt.textContent = status.connected ? "Connected" : "Disconnected";
  wrap.append(dot, txt);
  return wrap;
}

async function fetchConnectionStatus(connectionId) {
  try {
    const res = await apiRequest(`/api/connections/${connectionId}/status`);
    return { connected: Boolean(res.connected) };
  } catch {
    return { connected: false };
  }
}

async function loadConnections() {
  const connections = await apiRequest("/api/connections");
  const list = document.getElementById("connection-list");
  list.innerHTML = "";
  setDashboardStats(connections);

  if (!connections.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "muted";
    td.textContent = "No workspaces yet. Click '+ Add Connection' to create one.";
    tr.appendChild(td);
    list.appendChild(tr);
    return;
  }

  const statuses = await Promise.all(connections.map((c) => fetchConnectionStatus(c.id)));

  connections.forEach((conn, idx) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.innerHTML = `<strong>${conn.name}</strong>`;

    const engineTd = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = conn.engine.toUpperCase();
    engineTd.appendChild(chip);

    const hostTd = document.createElement("td");
    hostTd.className = "muted";
    hostTd.textContent = `${conn.server || "from connection string"} / ${conn.database_name || "-"}`;

    const statusTd = document.createElement("td");
    statusTd.appendChild(statusCell(statuses[idx]));

    const actionsTd = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "actions-row";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open";
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
      const ok = window.confirm(`Delete workspace '${conn.name}'? This will also delete its saved queries.`);
      if (!ok) return;
      try {
        await apiRequest(`/api/connections/${conn.id}`, { method: "DELETE" });
        showSuccess("Workspace deleted.");
        await loadConnections();
      } catch (err) {
        showError(err.message);
      }
    });

    actions.append(openBtn, editBtn, deleteBtn);
    actionsTd.appendChild(actions);

    tr.append(nameTd, engineTd, hostTd, statusTd, actionsTd);
    list.appendChild(tr);
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

    document.getElementById("test-connection-btn").addEventListener("click", async () => {
      try {
        const payload = getPayloadFromForm();
        const result = await apiRequest("/api/connections/test", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showSuccess(result.message || "Connection test succeeded.");
      } catch (err) {
        showError(err.message);
      }
    });

    document.getElementById("connection-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = getPayloadFromForm();

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
