let availableRoles = [];
let usersCache = [];

function fillRoleSelect(selectEl, selectedRole) {
  selectEl.innerHTML = "";
  availableRoles.forEach((role) => {
    const opt = document.createElement("option");
    opt.value = role.name;
    opt.textContent = role.name;
    if (String(selectedRole || "").toLowerCase() === role.name) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function resetCreateForm() {
  const form = document.getElementById("create-user-form");
  form.reset();
  document.getElementById("new-max").value = 5;
  fillRoleSelect(document.getElementById("new-role"), "user");
}

function openEditUserModal(user) {
  document.getElementById("edit-user-id").value = user.id;
  document.getElementById("edit-username").value = user.username;
  document.getElementById("edit-provider").value = user.provider;
  fillRoleSelect(document.getElementById("edit-role"), user.role);
  document.getElementById("edit-max").value = user.max_connections;
  openModal("edit-user-modal");
}

function buildRow(user) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${user.id}</td><td>${user.username}</td><td>${user.email || "-"}</td><td>${user.provider}</td><td>${user.role}</td><td>${user.connection_count}</td><td>${user.max_connections}</td>`;

  const actionTd = document.createElement("td");
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "secondary";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditUserModal(user));
  actionTd.appendChild(editBtn);

  tr.appendChild(actionTd);
  return tr;
}

(async function initUsersPage() {
  const me = await requireUserOrRedirect();
  if (!me) return;
  document.getElementById("user-chip").textContent = `Signed in: ${me.username}`;
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await apiRequest("/api/logout", { method: "POST" });
    window.location.href = "/";
  });

  async function loadRoles() {
    availableRoles = await apiRequest("/api/admin/roles");
    fillRoleSelect(document.getElementById("new-role"), "user");
    fillRoleSelect(document.getElementById("edit-role"), "user");
  }

  async function loadUsers() {
    usersCache = await apiRequest("/api/admin/users");
    const tbody = document.getElementById("users-tbody");
    tbody.innerHTML = "";
    usersCache.forEach((u) => tbody.appendChild(buildRow(u)));
  }

  async function loadAll() {
    try {
      await loadRoles();
      await loadUsers();
      document.getElementById("forbidden-text").classList.add("hidden");
      document.getElementById("users-panel").classList.remove("hidden");
    } catch {
      document.getElementById("forbidden-text").classList.remove("hidden");
      document.getElementById("users-panel").classList.add("hidden");
    }
  }

  document.getElementById("open-create-user-modal-btn").addEventListener("click", () => {
    resetCreateForm();
    openModal("create-user-modal");
  });

  document.getElementById("close-create-user-modal-btn").addEventListener("click", () => closeModal("create-user-modal"));
  document.getElementById("cancel-create-user-btn").addEventListener("click", () => closeModal("create-user-modal"));
  document.getElementById("create-user-modal").addEventListener("click", (e) => {
    if (e.target.id === "create-user-modal") closeModal("create-user-modal");
  });

  document.getElementById("close-edit-user-modal-btn").addEventListener("click", () => closeModal("edit-user-modal"));
  document.getElementById("cancel-edit-user-btn").addEventListener("click", () => closeModal("edit-user-modal"));
  document.getElementById("edit-user-modal").addEventListener("click", (e) => {
    if (e.target.id === "edit-user-modal") closeModal("edit-user-modal");
  });

  document.getElementById("create-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const created = await apiRequest("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: document.getElementById("new-username").value,
          email: document.getElementById("new-email").value,
          password: document.getElementById("new-password").value,
          role: document.getElementById("new-role").value,
          max_connections: Number(document.getElementById("new-max").value),
          send_invite: document.getElementById("send-invite").checked,
        }),
      });
      closeModal("create-user-modal");
      await loadAll();
      if (created?.invitation?.setup_url) {
        const inviteState = created.invitation.delivered
          ? "Invite email sent."
          : "Invite link created (delivery webhook not configured).";
        showSuccess(`${inviteState} Setup URL: ${created.invitation.setup_url}`);
      } else {
        showSuccess("User created.");
      }
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById("edit-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const id = document.getElementById("edit-user-id").value;
      await apiRequest(`/api/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          role: document.getElementById("edit-role").value,
          max_connections: Number(document.getElementById("edit-max").value),
        }),
      });
      closeModal("edit-user-modal");
      await loadAll();
      showSuccess("User updated.");
    } catch (err) {
      showError(err.message);
    }
  });

  await loadAll();
})();
