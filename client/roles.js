function buildRoleRow(user, reload) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${user.id}</td><td>${user.username}</td><td>${user.provider}</td>`;

  const roleTd = document.createElement("td");
  const select = document.createElement("select");
  ["user", "admin"].forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    if (user.role === r) opt.selected = true;
    select.appendChild(opt);
  });
  roleTd.appendChild(select);

  const actionTd = document.createElement("td");
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "secondary";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", async () => {
    try {
      await apiRequest(`/api/admin/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({ role: select.value }),
      });
      showSuccess(`Updated role for ${user.username}.`);
      await reload();
    } catch (err) {
      showError(err.message);
    }
  });
  actionTd.appendChild(saveBtn);

  tr.append(roleTd, actionTd);
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
      const users = await apiRequest("/api/admin/users");
      document.getElementById("forbidden-text").classList.add("hidden");
      document.getElementById("roles-panel").classList.remove("hidden");
      const tbody = document.getElementById("roles-tbody");
      tbody.innerHTML = "";
      users.forEach((u) => tbody.appendChild(buildRoleRow(u, load)));
    } catch {
      document.getElementById("forbidden-text").classList.remove("hidden");
      document.getElementById("roles-panel").classList.add("hidden");
    }
  }

  await load();
})();
