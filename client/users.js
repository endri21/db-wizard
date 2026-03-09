let availableRoles = [];
let usersCache = [];
let currentUserId = null;

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

function setBusy(isBusy, label = "Processing request…") {
  const overlay = document.getElementById("users-loading");
  const panel = document.getElementById("users-panel");
  if (!overlay || !panel) return;
  const textEl = overlay.querySelector("span");
  if (textEl) textEl.textContent = label;
  overlay.classList.toggle("hidden", !isBusy);
  panel.setAttribute("aria-busy", isBusy ? "true" : "false");
}

async function withBusy(label, action) {
  setBusy(true, label);
  try {
    return await action();
  } finally {
    setBusy(false);
  }
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

async function handleDeleteUser(user) {
  const isSelf = Number(user.id) === Number(currentUserId);
  if (isSelf) {
    showError("You cannot delete your own account.");
    return;
  }

  const confirmed = window.confirm(`Delete ${user.username} (${user.email || "no-email"})? This action cannot be undone.`);
  if (!confirmed) return;

  try {
    await withBusy("Deleting user…", async () => {
      await apiRequest(`/api/admin/users/${user.id}`, { method: "DELETE" });
      await loadAll();
    });
    showSuccess("User deleted.");
  } catch (err) {
    showError(err.message);
  }
}

function buildRow(user) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${user.id}</td><td>${user.username}</td><td>${user.email || "-"}</td><td>${user.provider}</td><td>${user.role}</td><td>${user.connection_count}</td><td>${user.max_connections}</td>`;

  const actionTd = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "secondary btn-small";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditUserModal(user));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "danger btn-small";
  deleteBtn.textContent = "Delete";
  if (Number(user.id) === Number(currentUserId)) {
    deleteBtn.disabled = true;
    deleteBtn.title = "You cannot delete your own account.";
  }
  deleteBtn.addEventListener("click", () => handleDeleteUser(user));

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  actionTd.appendChild(actions);

  tr.appendChild(actionTd);
  return tr;
}

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

(async function initUsersPage() {
  const me = await requireUserOrRedirect();
  if (!me) return;

  currentUserId = Number(me.id);
  document.getElementById("user-chip").textContent = `Signed in: ${me.username}`;
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await apiRequest("/api/logout", { method: "POST" });
    window.location.href = "/";
  });

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
      const payload = {
        email: document.getElementById("new-email").value,
        role: document.getElementById("new-role").value,
        max_connections: Number(document.getElementById("new-max").value),
      };

      const created = await withBusy("Sending invitation email…", async () => {
        const createdInvite = await apiRequest("/api/admin/invites", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await loadAll();
        return createdInvite;
      });

      closeModal("create-user-modal");
      if (created?.invitation?.invite_url) {
        const inviteState = created.invitation.delivered
          ? "Invite email sent."
          : "Invite link created (delivery not configured).";
        showSuccess(`${inviteState} Invite URL: ${created.invitation.invite_url}`);
      } else {
        showSuccess("Invite created.");
      }
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById("edit-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const id = document.getElementById("edit-user-id").value;
      await withBusy("Updating user…", async () => {
        await apiRequest(`/api/admin/users/${id}`, {
          method: "PUT",
          body: JSON.stringify({
            role: document.getElementById("edit-role").value,
            max_connections: Number(document.getElementById("edit-max").value),
          }),
        });
        await loadAll();
      });
      closeModal("edit-user-modal");
      showSuccess("User updated.");
    } catch (err) {
      showError(err.message);
    }
  });

  await withBusy("Loading users…", async () => {
    await loadAll();
  });
})();
