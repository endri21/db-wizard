function buildRow(user, reload) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${user.id}</td><td>${user.username}</td><td>${user.provider}</td><td>${user.connection_count}</td>`;

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
        body: JSON.stringify({ max_connections: Number(maxInput.value) }),
      });
      showSuccess(`Updated limit for ${user.username}.`);
      await reload();
    } catch (err) {
      showError(err.message);
    }
  });

  actionTd.appendChild(saveBtn);
  tr.append(maxTd, actionTd);
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

  async function load() {
    try {
      const users = await apiRequest("/api/admin/users");
      document.getElementById("forbidden-text").classList.add("hidden");
      document.getElementById("users-panel").classList.remove("hidden");
      const tbody = document.getElementById("users-tbody");
      tbody.innerHTML = "";
      users.forEach((u) => tbody.appendChild(buildRow(u, load)));
    } catch {
      document.getElementById("forbidden-text").classList.remove("hidden");
      document.getElementById("users-panel").classList.add("hidden");
    }
  }

  await load();
})();
