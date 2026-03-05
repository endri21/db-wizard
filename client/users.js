let availableRoles = [];

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

function buildRow(user, reload) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${user.id}</td><td>${user.username}</td><td>${user.provider}</td>`;

  const roleTd = document.createElement("td");
  const roleSelect = document.createElement("select");
  fillRoleSelect(roleSelect, user.role);
  roleTd.appendChild(roleSelect);

  const countTd = document.createElement("td");
  countTd.textContent = user.connection_count;

  const maxTd = document.createElement("td");
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.min = "1";
  maxInput.max = "200";
  maxInput.value = user.max_connections;
  maxInput.style.width = "100px";
  maxTd.appendChild(maxInput);

  const actionTd = document.createElement("td");
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "secondary";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", async () => {
    try {
      await apiRequest(`/api/admin/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({ role: roleSelect.value, max_connections: Number(maxInput.value) }),
      });
      showSuccess(`Updated ${user.username}.`);
      await reload();
    } catch (err) {
      showError(err.message);
    }
  });

  actionTd.appendChild(saveBtn);
  tr.append(roleTd, countTd, maxTd, actionTd);
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
    const createSelect = document.getElementById("new-role");
    fillRoleSelect(createSelect, "user");
  }

  async function loadUsers() {
    const users = await apiRequest("/api/admin/users");
    const tbody = document.getElementById("users-tbody");
    tbody.innerHTML = "";
    users.forEach((u) => tbody.appendChild(buildRow(u, loadAll)));
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

  document.getElementById("create-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: document.getElementById("new-username").value,
          password: document.getElementById("new-password").value,
          role: document.getElementById("new-role").value,
          max_connections: Number(document.getElementById("new-max").value),
        }),
      });
      e.target.reset();
      document.getElementById("new-max").value = 5;
      await loadAll();
      showSuccess("User created.");
    } catch (err) {
      showError(err.message);
    }
  });

  await loadAll();
})();
