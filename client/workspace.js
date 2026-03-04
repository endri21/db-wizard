let editingSavedQueryId = null;
let currentEngine = "postgresql";
let activeContextMenu = null;

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

function setEditorQuery(query, queryName = "") {
  document.getElementById("query-text").value = query;
  if (queryName) document.getElementById("query-name").value = queryName;
}

function tableSelectTemplate(engine, schema, table) {
  if (engine === "mysql") {
    return `SELECT *\nFROM \`${schema}\`.\`${table}\`\nLIMIT 200;`;
  }

  if (engine === "mssql") {
    return `SELECT TOP 200 *\nFROM [${schema}].[${table}];`;
  }

  return `SELECT *\nFROM "${schema}"."${table}"\nLIMIT 200;`;
}

function tableUpdateTemplate(engine, schema, table) {
  if (engine === "mysql") {
    return `UPDATE \`${schema}\`.\`${table}\`\nSET column_name = 'new_value'\nWHERE condition;`;
  }
  if (engine === "mssql") {
    return `UPDATE [${schema}].[${table}]\nSET column_name = 'new_value'\nWHERE condition;`;
  }
  return `UPDATE "${schema}"."${table}"\nSET column_name = 'new_value'\nWHERE condition;`;
}

function tableInsertTemplate(engine, schema, table) {
  if (engine === "mysql") {
    return `INSERT INTO \`${schema}\`.\`${table}\` (column1, column2)\nVALUES ('value1', 'value2');`;
  }
  if (engine === "mssql") {
    return `INSERT INTO [${schema}].[${table}] (column1, column2)\nVALUES ('value1', 'value2');`;
  }
  return `INSERT INTO "${schema}"."${table}" (column1, column2)\nVALUES ('value1', 'value2');`;
}

function schemaStructureTemplate(engine, schema) {
  if (engine === "mysql") {
    return `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE\nFROM INFORMATION_SCHEMA.COLUMNS\nWHERE TABLE_SCHEMA = '${schema}'\nORDER BY TABLE_NAME, ORDINAL_POSITION;`;
  }
  if (engine === "mssql") {
    return `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE\nFROM INFORMATION_SCHEMA.COLUMNS\nWHERE TABLE_SCHEMA = '${schema}'\nORDER BY TABLE_NAME, ORDINAL_POSITION;`;
  }
  return `SELECT table_name, column_name, data_type, is_nullable\nFROM information_schema.columns\nWHERE table_schema = '${schema}'\nORDER BY table_name, ordinal_position;`;
}

function procedureInspectTemplate(engine, schema, procedure) {
  if (engine === "mysql") {
    return `SHOW CREATE PROCEDURE \`${schema}\`.\`${procedure}\`;`;
  }

  if (engine === "mssql") {
    return `SELECT OBJECT_DEFINITION(OBJECT_ID('${schema}.${procedure}')) AS procedure_definition;`;
  }

  return `SELECT p.proname AS procedure_name, pg_get_functiondef(p.oid) AS definition\nFROM pg_proc p\nJOIN pg_namespace n ON n.oid = p.pronamespace\nWHERE n.nspname = '${schema}'\n  AND p.proname = '${procedure}';`;
}

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function showTableContextMenu({ x, y, schema, table }) {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  const options = [
    {
      label: "SELECT query",
      action: () => setEditorQuery(tableSelectTemplate(currentEngine, schema, table), `${schema}.${table}`),
    },
    {
      label: "UPDATE query",
      action: () => setEditorQuery(tableUpdateTemplate(currentEngine, schema, table), `${schema}.${table}`),
    },
    {
      label: "INSERT query",
      action: () => setEditorQuery(tableInsertTemplate(currentEngine, schema, table), `${schema}.${table}`),
    },
  ];

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-item";
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      opt.action();
      showSuccess(`${opt.label} filled.`);
      closeContextMenu();
    });
    menu.appendChild(btn);
  });

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  document.body.appendChild(menu);
  activeContextMenu = menu;
}

function renderSchemaTree(schemas = []) {
  const tree = document.getElementById("schema-tree");
  tree.innerHTML = "";

  if (!schemas.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No schemas/tables/procedures found.";
    tree.appendChild(li);
    return;
  }

  schemas.forEach((schemaNode) => {
    const schemaLi = document.createElement("li");
    schemaLi.className = "schema-node";

    const schemaToggle = document.createElement("button");
    schemaToggle.className = "tree-toggle";
    schemaToggle.textContent = `▸ ${schemaNode.schema}`;

    const schemaBody = document.createElement("div");
    schemaBody.className = "schema-body hidden";

    schemaToggle.addEventListener("click", () => {
      const hidden = schemaBody.classList.toggle("hidden");
      schemaToggle.textContent = `${hidden ? "▸" : "▾"} ${schemaNode.schema}`;

      const sql = schemaStructureTemplate(currentEngine, schemaNode.schema);
      setEditorQuery(sql, `${schemaNode.schema}.schema`);
      showSuccess("Schema structure query filled.");
    });

    const tablesTitle = document.createElement("p");
    tablesTitle.className = "tree-section-title";
    tablesTitle.textContent = `Tables (${schemaNode.tables.length})`;
    schemaBody.appendChild(tablesTitle);

    const tablesUl = document.createElement("ul");
    tablesUl.className = "tree-list";
    schemaNode.tables.forEach((table) => {
      const item = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "tree-leaf";
      btn.textContent = table.name;
      btn.addEventListener("click", () => {
        const sql = tableSelectTemplate(currentEngine, schemaNode.schema, table.name);
        setEditorQuery(sql, `${schemaNode.schema}.${table.name}`);
        showSuccess("SELECT query filled for table.");
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showTableContextMenu({ x: e.clientX, y: e.clientY, schema: schemaNode.schema, table: table.name });
      });
      item.appendChild(btn);
      tablesUl.appendChild(item);
    });
    if (!schemaNode.tables.length) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = "No tables";
      tablesUl.appendChild(item);
    }
    schemaBody.appendChild(tablesUl);

    const procsTitle = document.createElement("p");
    procsTitle.className = "tree-section-title";
    procsTitle.textContent = `Stored Procedures (${schemaNode.procedures.length})`;
    schemaBody.appendChild(procsTitle);

    const procsUl = document.createElement("ul");
    procsUl.className = "tree-list";
    schemaNode.procedures.forEach((proc) => {
      const item = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "tree-leaf";
      btn.textContent = proc.name;
      btn.addEventListener("click", () => {
        const sql = procedureInspectTemplate(currentEngine, schemaNode.schema, proc.name);
        setEditorQuery(sql, `${schemaNode.schema}.${proc.name}`);
        showSuccess("Procedure query template filled.");
      });
      item.appendChild(btn);
      procsUl.appendChild(item);
    });
    if (!schemaNode.procedures.length) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = "No procedures";
      procsUl.appendChild(item);
    }
    schemaBody.appendChild(procsUl);

    schemaLi.append(schemaToggle, schemaBody);
    tree.appendChild(schemaLi);
  });
}

async function loadSchemas(connectionId) {
  const data = await apiRequest(`/api/connections/${connectionId}/tables`);
  renderSchemaTree(data.schemas || []);
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

  document.addEventListener("click", (e) => {
    if (activeContextMenu && !e.target.closest(".context-menu")) {
      closeContextMenu();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeContextMenu();
  });
  window.addEventListener("scroll", closeContextMenu, true);

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

    currentEngine = String(current.engine || "postgresql").toLowerCase();
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

    await Promise.all([loadSchemas(connectionId), loadSavedQueries(connectionId)]);
  } catch (err) {
    showError(err.message);
  }
})();
