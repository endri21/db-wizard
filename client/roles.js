function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function openEditRoleModal(role) {
  document.getElementById("edit-role-old-name").value = role.name;
  document.getElementById("edit-role-name").value = role.name;
  openModal("edit-role-modal");
}

function buildRoleRow(role, reload) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${role.name}</td><td>${role.user_count}</td><td>${new Date(role.created_at).toLocaleString()}</td>`;

  const actionTd = document.createElement("td");

  const actions = document.createElement("div");
  actions.className = "actions-row";

  if (["admin", "user"].includes(String(role.name).toLowerCase())) {
    const fixed = document.createElement("span");
    fixed.className = "muted";
    fixed.textContent = "System role";
    actionTd.appendChild(fixed);
  } else {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openEditRoleModal(role));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      try {
        await apiRequest(`/api/admin/roles/${encodeURIComponent(role.name)}`, { method: "DELETE" });
        await reload();
        showSuccess(`Role '${role.name}' deleted.`);
      } catch (err) {
        showError(err.message);
      }
    });

    actions.append(editBtn, delBtn);
    actionTd.appendChild(actions);
  }

  tr.appendChild(actionTd);
  return tr;
}

(async function initRolesPage() {
  const me = await requireUserOrRedirect();
  if (!me) return;
  document.getElementById("user-chip").textContent = `Signed in: ${me.username}`;
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await apiRequest("/api/logout", { method: "POST" });
    window.location.href = "/";
  });

  async function load() {
    try {
      const roles = await apiRequest("/api/admin/roles");
      document.getElementById("forbidden-text").classList.add("hidden");
      document.getElementById("roles-panel").classList.remove("hidden");
      const tbody = document.getElementById("roles-tbody");
      tbody.innerHTML = "";
      roles.forEach((r) => tbody.appendChild(buildRoleRow(r, load)));
    } catch {
      document.getElementById("forbidden-text").classList.remove("hidden");
      document.getElementById("roles-panel").classList.add("hidden");
    }
  }

  document.getElementById("open-create-role-modal-btn").addEventListener("click", () => {
    document.getElementById("create-role-form").reset();
    openModal("create-role-modal");
  });

  document.getElementById("close-create-role-modal-btn").addEventListener("click", () => closeModal("create-role-modal"));
  document.getElementById("cancel-create-role-btn").addEventListener("click", () => closeModal("create-role-modal"));
  document.getElementById("create-role-modal").addEventListener("click", (e) => {
    if (e.target.id === "create-role-modal") closeModal("create-role-modal");
  });

  document.getElementById("close-edit-role-modal-btn").addEventListener("click", () => closeModal("edit-role-modal"));
  document.getElementById("cancel-edit-role-btn").addEventListener("click", () => closeModal("edit-role-modal"));
  document.getElementById("edit-role-modal").addEventListener("click", (e) => {
    if (e.target.id === "edit-role-modal") closeModal("edit-role-modal");
  });

  document.getElementById("create-role-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const name = document.getElementById("new-role-name").value.trim().toLowerCase();
      await apiRequest("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      closeModal("create-role-modal");
      await load();
      showSuccess(`Role '${name}' created.`);
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById("edit-role-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const oldName = document.getElementById("edit-role-old-name").value;
      const name = document.getElementById("edit-role-name").value.trim().toLowerCase();
      await apiRequest(`/api/admin/roles/${encodeURIComponent(oldName)}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      closeModal("edit-role-modal");
      await load();
      showSuccess("Role updated.");
    } catch (err) {
      showError(err.message);
    }
  });

  await load();
})();
