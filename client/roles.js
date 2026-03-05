function buildRoleRow(role, reload) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${role.name}</td><td>${role.user_count}</td><td>${new Date(role.created_at).toLocaleString()}</td>`;

  const actionTd = document.createElement("td");
  if (["admin", "user"].includes(String(role.name).toLowerCase())) {
    const fixed = document.createElement("span");
    fixed.className = "muted";
    fixed.textContent = "System role";
    actionTd.appendChild(fixed);
  } else {
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
    actionTd.appendChild(delBtn);
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

  document.getElementById("create-role-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const name = document.getElementById("new-role-name").value.trim().toLowerCase();
      await apiRequest("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      e.target.reset();
      await load();
      showSuccess(`Role '${name}' created.`);
    } catch (err) {
      showError(err.message);
    }
  });

  await load();
})();
