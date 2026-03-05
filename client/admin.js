function buildUserRow(user) {
  const tr = document.createElement("tr");

  const idTd = document.createElement("td");
  idTd.textContent = user.id;

  const usernameTd = document.createElement("td");
  usernameTd.textContent = user.username;

  const providerTd = document.createElement("td");
  providerTd.textContent = user.provider;

  const roleTd = document.createElement("td");
  const roleSelect = document.createElement("select");
  ["user", "admin"].forEach((role) => {
    const opt = document.createElement("option");
    opt.value = role;
    opt.textContent = role;
    if (user.role === role) opt.selected = true;
    roleSelect.appendChild(opt);
  });
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
      await loadUsers();
    } catch (err) {
      showError(err.message);
    }
  });

  actionTd.appendChild(saveBtn);

  tr.append(idTd, usernameTd, providerTd, roleTd, countTd, maxTd, actionTd);
  return tr;
}

async function loadUsers() {
  const users = await apiRequest("/api/admin/users");
  const tbody = document.getElementById("admin-user-tbody");
  tbody.innerHTML = "";
  users.forEach((user) => tbody.appendChild(buildUserRow(user)));
}

(async function initAdmin() {
  try {
    const me = await requireUserOrRedirect();
    if (!me) return;
    if (String(me.role || "").toLowerCase() !== "admin") {
      window.location.href = "/dashboard";
      return;
    }

    document.getElementById("user-chip").textContent = `Signed in: ${me.username} (${me.role})`;
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await apiRequest("/api/logout", { method: "POST" });
      window.location.href = "/";
    });

    await loadUsers();
  } catch (err) {
    showError(err.message);
  }
})();
