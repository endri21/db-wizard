let editingConnectionId = null;
let currentView = localStorage.getItem("dashboard_view") || "card";
let pendingDeleteConnection = null;

function setDashboardStats(connections) {
  document.title = `DB Wizard | Dashboard (${connections.length})`;
}

function openModal() {
  document.getElementById("connection-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("connection-modal").classList.add("hidden");
}

function openDeleteModal(conn) {
  pendingDeleteConnection = conn;
  document.getElementById("delete-confirm-message").textContent =
    `You are about to delete '${conn.name}'. Saved queries under this workspace will also be removed.`;
  document.getElementById("delete-confirm-modal").classList.remove("hidden");
}

function closeDeleteModal() {
  pendingDeleteConnection = null;
  document.getElementById("delete-confirm-modal").classList.add("hidden");
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

function statusCell(status = { state: "checking" }) {
  const wrap = document.createElement("div");
  wrap.className = "status-wrap";

  const dot = document.createElement("span");
  const txt = document.createElement("span");

  if (status.state === "checking") {
    dot.className = "status-dot checking";
    txt.textContent = "Checking...";
  } else if (status.connected) {
    dot.className = "status-dot ok";
    txt.textContent = "Connected";
  } else {
    dot.className = "status-dot bad";
    txt.textContent = "Disconnected";
  }

  wrap.append(dot, txt);
  return wrap;
}

async function fetchConnectionStatus(connectionId) {
  try {
    const res = await apiRequest(`/api/connections/${connectionId}/status`);
    return { state: "done", connected: Boolean(res.connected) };
  } catch {
    return { state: "done", connected: false };
  }
}

function setStatusForConnection(connectionId, status) {
  document.querySelectorAll(`[data-status-for="${connectionId}"]`).forEach((el) => {
    el.innerHTML = "";
    el.appendChild(statusCell(status));
  });
}

async function refreshConnectionStatuses(connections) {
  await Promise.all(
    connections.map(async (conn) => {
      const status = await fetchConnectionStatus(conn.id);
      setStatusForConnection(conn.id, status);
    })
  );
}

function actionIconButton(symbol, title, className = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `icon-btn ${className}`.trim();
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.textContent = symbol;
  return btn;
}

function applyViewMode() {
  const cardList = document.getElementById("connection-card-list");
  const tableWrap = document.getElementById("connection-table-wrap");
  const cardBtn = document.getElementById("view-card-btn");
  const tableBtn = document.getElementById("view-table-btn");

  if (currentView === "table") {
    cardList.classList.add("hidden");
    tableWrap.classList.remove("hidden");
    cardBtn.classList.remove("active");
    tableBtn.classList.add("active");
  } else {
    tableWrap.classList.add("hidden");
    cardList.classList.remove("hidden");
    tableBtn.classList.remove("active");
    cardBtn.classList.add("active");
  }

  localStorage.setItem("dashboard_view", currentView);
}

function buildCardRow(conn) {
  const li = document.createElement("li");
  li.className = "resource-card";

  const top = document.createElement("div");
  top.className = "resource-card-top";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = conn.name;
  const subtitle = document.createElement("p");
  subtitle.className = "muted";
  subtitle.textContent = `${conn.server || "from connection string"} / ${conn.database_name || "-"}`;
  titleWrap.append(title, subtitle);

  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = conn.engine.toUpperCase();

  top.append(titleWrap, chip);

  const stat = document.createElement("div");
  stat.dataset.statusFor = String(conn.id);
  stat.appendChild(statusCell({ state: "checking" }));

  const actions = document.createElement("div");
  actions.className = "actions-row";

  const openBtn = actionIconButton("↗", "Open workspace");
  openBtn.addEventListener("click", () => {
    window.location.href = `/workspace/${conn.id}`;
  });

  const editBtn = actionIconButton("✎", "Edit workspace", "secondary");
  editBtn.addEventListener("click", () => startEditConnection(conn));

  const deleteBtn = actionIconButton("🗑", "Delete workspace", "danger");
  deleteBtn.addEventListener("click", () => openDeleteModal(conn));

  actions.append(openBtn, editBtn, deleteBtn);
  li.append(top, stat, actions);
  return li;
}

function buildTableRow(conn) {
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
  hostTd.textContent = conn.server || "from connection string";

  const statusTd = document.createElement("td");
  statusTd.dataset.statusFor = String(conn.id);
  statusTd.appendChild(statusCell({ state: "checking" }));

  const actionsTd = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "actions-row";

  const openBtn = actionIconButton("↗", "Open workspace");
  openBtn.addEventListener("click", () => {
    window.location.href = `/workspace/${conn.id}`;
  });

  const editBtn = actionIconButton("✎", "Edit workspace", "secondary");
  editBtn.addEventListener("click", () => startEditConnection(conn));

  const deleteBtn = actionIconButton("🗑", "Delete workspace", "danger");
  deleteBtn.addEventListener("click", () => openDeleteModal(conn));

  actions.append(openBtn, editBtn, deleteBtn);
  actionsTd.appendChild(actions);

  tr.append(nameTd, engineTd, hostTd, statusTd, actionsTd);
  return tr;
}

async function loadConnections() {
  const connections = await apiRequest("/api/connections");
  const cardList = document.getElementById("connection-card-list");
  const tableBody = document.getElementById("connection-table-body");
  cardList.innerHTML = "";
  tableBody.innerHTML = "";
  setDashboardStats(connections);

  if (!connections.length) {
    const emptyCard = document.createElement("li");
    emptyCard.className = "panel muted";
    emptyCard.textContent = "No workspaces yet. Click '+ Add' to create one.";
    cardList.appendChild(emptyCard);

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "muted";
    td.textContent = "No workspaces yet. Click '+ Add' to create one.";
    tr.appendChild(td);
    tableBody.appendChild(tr);
    applyViewMode();
    return;
  }

  connections.forEach((conn) => {
    cardList.appendChild(buildCardRow(conn));
    tableBody.appendChild(buildTableRow(conn));
  });

  applyViewMode();
  refreshConnectionStatuses(connections);
}

(async function initDashboard() {
  try {
    const user = await requireUserOrRedirect();
    if (!user) return;
    document.getElementById("user-chip").textContent = `Signed in: ${user.username}`;
    if (String(user.role || "").toLowerCase() === "admin") {
      document.getElementById("users-link").classList.remove("hidden");
      document.getElementById("roles-link").classList.remove("hidden");
    } else {
      try {
        await apiRequest("/api/admin/users");
        document.getElementById("users-link").classList.remove("hidden");
      document.getElementById("roles-link").classList.remove("hidden");
      } catch {
        // not admin; keep hidden
      }
    }

    document.getElementById("logout-btn").addEventListener("click", async () => {
      await apiRequest("/api/logout", { method: "POST" });
      window.location.href = "/";
    });

    document.getElementById("view-card-btn").addEventListener("click", () => {
      currentView = "card";
      applyViewMode();
    });
    document.getElementById("view-table-btn").addEventListener("click", () => {
      currentView = "table";
      applyViewMode();
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

    document.getElementById("close-delete-modal-btn").addEventListener("click", closeDeleteModal);
    document.getElementById("cancel-delete-btn").addEventListener("click", closeDeleteModal);
    document.getElementById("delete-confirm-modal").addEventListener("click", (e) => {
      if (e.target.id === "delete-confirm-modal") closeDeleteModal();
    });

    document.getElementById("confirm-delete-btn").addEventListener("click", async () => {
      if (!pendingDeleteConnection) return;
      try {
        await apiRequest(`/api/connections/${pendingDeleteConnection.id}`, { method: "DELETE" });
        closeDeleteModal();
        showSuccess("Workspace deleted.");
        await loadConnections();
      } catch (err) {
        showError(err.message);
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
