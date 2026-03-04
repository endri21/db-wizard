let editingSavedQueryId = null;

function connectionIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[1];
}

function renderResult(result) {
  const wrap = document.getElementById("result-wrap");
  const head = document.getElementById("result-head");
  const body = document.getElementById("result-body");

  if (!result || !result.columns) {
    wrap.classList.add("hidden");
    head.innerHTML = "";
    body.innerHTML = "";
    return;
  }

  wrap.classList.remove("hidden");
  head.innerHTML = "";
  body.innerHTML = "";

  result.columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    head.appendChild(th);
  });

  result.rows.forEach((row) => {
    const tr = document.createElement("tr");
    result.columns.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = String(row[c] ?? "");
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function normalizeTableRow(row) {
  if (typeof row === "string") {
    return { schema: "default", name: row };
  }
  return {
    schema: row.schema || "default",
    name: row.name || row.table_name || "unknown",
  };
}

async function loadTables(connectionId) {
  const data = await apiRequest(`/api/connections/${connectionId}/tables`);
  const list = document.getElementById("table-list");
  list.innerHTML = "";

  if (!data.tables.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No tables found.";
    list.appendChild(li);
    return;
  }

  data.tables.map(normalizeTableRow).forEach((table) => {
    const li = document.createElement("li");
    li.className = "table-item";

    const schemaChip = document.createElement("span");
    schemaChip.className = "schema-chip";
    schemaChip.textContent = table.schema;

    const name = document.createElement("span");
    name.className = "table-name";
    name.textContent = table.name;

    li.append(schemaChip, name);
    list.appendChild(li);
  });
}

async function loadSavedQueries(connectionId) {
  const data = await apiRequest(`/api/connections/${connectionId}/saved-queries`);
  const list = document.getElementById("saved-query-list");
  list.innerHTML = "";

  if (!data.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No saved queries yet.";
    list.appendChild(li);
    return;
  }

  data.forEach((item) => {
    const li = document.createElement("li");

    const title = document.createElement("strong");
    title.textContent = item.name;

    const preview = document.createElement("p");
    preview.className = "muted";
    preview.textContent = item.sql_text.slice(0, 120);

    const actions = document.createElement("div");
    actions.className = "actions-row";

    const loadBtn = document.createElement("button");
    loadBtn.className = "secondary";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => {
      editingSavedQueryId = item.id;
      document.getElementById("query-name").value = item.name;
      document.getElementById("query-text").value = item.sql_text;
      document.getElementById("save-query-btn").textContent = "Update Saved";
    });

    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.addEventListener("click", async () => {
      try {
        const result = await apiRequest(`/api/connections/${connectionId}/saved-queries/${item.id}/run`, {
          method: "POST",
        });
        renderResult(result);
        showSuccess("Saved query executed.");
      } catch (err) {
        showError(err.message);
      }
    });

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      try {
        await apiRequest(`/api/connections/${connectionId}/saved-queries/${item.id}`, { method: "DELETE" });
        await loadSavedQueries(connectionId);
        showSuccess("Saved query deleted.");
      } catch (err) {
        showError(err.message);
      }
    });

    actions.append(loadBtn, runBtn, delBtn);
    li.append(title, preview, actions);
    list.appendChild(li);
  });
}

(async function initWorkspace() {
  const connectionId = connectionIdFromPath();
  if (!connectionId) {
    window.location.href = "/dashboard";
    return;
  }

  try {
    const user = await requireUserOrRedirect();
    if (!user) return;
    document.getElementById("user-chip").textContent = `Signed in: ${user.username}`;

    document.getElementById("logout-btn").addEventListener("click", async () => {
      await apiRequest("/api/logout", { method: "POST" });
      window.location.href = "/";
    });

    const connections = await apiRequest("/api/connections");
    const current = connections.find((c) => String(c.id) === String(connectionId));
    if (!current) {
      showError("Connection not found.");
      return;
    }

    document.getElementById("connection-chip").textContent = `${current.name} (${current.engine})`;
    document.getElementById("workspace-subtitle").textContent = `SQL Workspace • ${current.name}`;

    document.getElementById("run-query-btn").addEventListener("click", async () => {
      try {
        const query = document.getElementById("query-text").value;
        const result = await apiRequest(`/api/connections/${connectionId}/query`, {
          method: "POST",
          body: JSON.stringify({ query }),
        });
        renderResult(result);
        showSuccess("Query executed.");
      } catch (err) {
        showError(err.message);
      }
    });

    document.getElementById("save-query-btn").addEventListener("click", async () => {
      try {
        const name = document.getElementById("query-name").value;
        const sql_text = document.getElementById("query-text").value;
        const isUpdate = Boolean(editingSavedQueryId);

        if (isUpdate) {
          await apiRequest(`/api/connections/${connectionId}/saved-queries/${editingSavedQueryId}`, {
            method: "PUT",
            body: JSON.stringify({ name, sql_text }),
          });
        } else {
          await apiRequest(`/api/connections/${connectionId}/saved-queries`, {
            method: "POST",
            body: JSON.stringify({ name, sql_text }),
          });
        }

        editingSavedQueryId = null;
        document.getElementById("save-query-btn").textContent = "Save Query";
        document.getElementById("query-name").value = "";
        await loadSavedQueries(connectionId);
        showSuccess(isUpdate ? "Saved query updated." : "Saved query created.");
      } catch (err) {
        showError(err.message);
      }
    });

    await Promise.all([loadTables(connectionId), loadSavedQueries(connectionId)]);
  } catch (err) {
    showError(err.message);
  }
})();
