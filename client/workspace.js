let editingSavedQueryId = null;
let currentEngine = "postgresql";
let activeContextMenu = null;
let schemaTreeCache = [];
let currentConnection = null;
let latestDiagramPayload = null;
let activateWorkspaceTab = null;

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

function createNodeLabel(icon, text, expanded = false) {
  const wrap = document.createElement("span");
  wrap.className = "tree-label";

  const caret = document.createElement("span");
  caret.className = "tree-caret";
  caret.textContent = expanded ? "▾" : "▸";

  const iconEl = document.createElement("span");
  iconEl.className = "tree-icon";
  iconEl.textContent = icon;

  const textEl = document.createElement("span");
  textEl.textContent = text;

  wrap.append(caret, iconEl, textEl);
  return { wrap, caret };
}

function showDatabaseContextMenu({ x, y }) {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "context-item";
  btn.textContent = "Choose tables for diagram";
  btn.addEventListener("click", () => {
    openDiagramModal();
    closeContextMenu();
  });

  menu.appendChild(btn);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  document.body.appendChild(menu);
  activeContextMenu = menu;
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
      closeContextMenu();
    });
    menu.appendChild(btn);
  });

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  document.body.appendChild(menu);
  activeContextMenu = menu;
}


function flattenTables(schemas = []) {
  return schemas.flatMap((schemaNode) =>
    (schemaNode.tables || []).map((table) => ({
      key: `${schemaNode.schema}.${table.name}`,
      schema: schemaNode.schema,
      name: table.name,
    }))
  );
}

function openDiagramModal() {
  const modal = document.getElementById("diagram-modal");
  const picker = document.getElementById("diagram-table-picker");
  picker.innerHTML = "";

  const tables = flattenTables(schemaTreeCache);
  if (!tables.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No tables available.";
    picker.appendChild(empty);
  } else {
    tables.forEach((table) => {
      const label = document.createElement("label");
      label.className = "table-picker-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = table.key;

      const text = document.createElement("span");
      text.textContent = table.key;

      label.append(cb, text);
      picker.appendChild(label);
    });
  }

  modal.classList.remove("hidden");
}

function closeDiagramModal() {
  document.getElementById("diagram-modal").classList.add("hidden");
}

function renderRelationshipDiagram(relationships, selectedTables, columns = []) {
  const canvas = document.getElementById("diagram-modal-canvas");
  const count = document.getElementById("diagram-modal-count");
  canvas.innerHTML = "";

  if (!selectedTables.length) {
    canvas.innerHTML = '<p class="muted">Select at least one table to generate the diagram.</p>';
    count.textContent = "No table selected.";
    return;
  }

  const selectedSet = new Set(selectedTables.map((t) => t.toLowerCase()));
  const relevant = relationships.filter((rel) => {
    const from = `${rel.from_schema}.${rel.from_table}`.toLowerCase();
    const to = `${rel.to_schema}.${rel.to_table}`.toLowerCase();
    return selectedSet.has(from) || selectedSet.has(to);
  });

  if (!relevant.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No foreign-key relationships found for the selected tables.";
    canvas.appendChild(empty);
    count.textContent = `${selectedTables.length} table(s), 0 relation(s)`;
    latestDiagramPayload = { generated_at: new Date().toISOString(), tables: selectedTables, relationships: [], columns };
    document.getElementById("diagram-view-modal").classList.remove("hidden");
    return;
  }

  const tableSet = new Set(selectedTables);
  relevant.forEach((rel) => {
    tableSet.add(`${rel.from_schema}.${rel.from_table}`);
    tableSet.add(`${rel.to_schema}.${rel.to_table}`);
  });
  const tableNames = Array.from(tableSet);

  const columnMap = new Map();
  columns.forEach((col) => {
    const key = `${col.schema}.${col.table_name}`;
    if (!columnMap.has(key)) columnMap.set(key, []);
    columnMap.get(key).push(col);
  });

  const fkMap = new Map();
  relevant.forEach((rel) => {
    const fromKey = `${rel.from_schema}.${rel.from_table}`;
    if (!fkMap.has(fromKey)) fkMap.set(fromKey, new Set());
    fkMap.get(fromKey).add(String(rel.from_column));
  });

  const viewport = document.createElement("div");
  viewport.className = "diagram-viewport";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "diagram-svg");
  viewport.appendChild(svg);

  const nodesLayer = document.createElement("div");
  nodesLayer.className = "diagram-nodes";
  viewport.appendChild(nodesLayer);

  const nodeMap = new Map();
  const positions = new Map();
  const layoutColumns = Math.max(2, Math.ceil(Math.sqrt(tableNames.length)));
  const horizontalGap = 350;
  const verticalGap = 240;

  tableNames.forEach((tableName, index) => {
    const col = index % layoutColumns;
    const row = Math.floor(index / layoutColumns);

    positions.set(tableName, { x: 24 + col * horizontalGap, y: 24 + row * verticalGap });

    const node = document.createElement("div");
    node.className = "diagram-node";
    node.dataset.table = tableName;
    if (selectedSet.has(tableName.toLowerCase())) node.classList.add("selected");

    const title = document.createElement("strong");
    title.textContent = tableName;

    const columnList = document.createElement("ul");
    columnList.className = "diagram-column-list";
    const tableColumns = (columnMap.get(tableName) || []).slice(0, 10);
    tableColumns.forEach((col) => {
      const li = document.createElement("li");
      li.className = "diagram-column-row";

      const left = document.createElement("span");
      left.textContent = `${col.column_name} · ${col.data_type}`;

      const badges = document.createElement("span");
      badges.className = "diagram-badges";
      if (String(col.is_primary) === "true" || String(col.is_primary) === "1") {
        const pk = document.createElement("em");
        pk.textContent = "PK";
        pk.className = "badge-pk";
        badges.appendChild(pk);
      }
      if ((fkMap.get(tableName) || new Set()).has(String(col.column_name))) {
        const fk = document.createElement("em");
        fk.textContent = "FK";
        fk.className = "badge-fk";
        badges.appendChild(fk);
      }

      li.append(left, badges);
      columnList.appendChild(li);
    });

    if ((columnMap.get(tableName) || []).length > tableColumns.length) {
      const more = document.createElement("li");
      more.className = "muted";
      more.textContent = `+${columnMap.get(tableName).length - tableColumns.length} more columns`;
      columnList.appendChild(more);
    }

    node.append(title, columnList);
    nodesLayer.appendChild(node);
    nodeMap.set(tableName, node);
  });

  const updateNodePositions = () => {
    nodeMap.forEach((node, tableName) => {
      const pos = positions.get(tableName);
      node.style.left = `${pos.x}px`;
      node.style.top = `${pos.y}px`;
    });
  };

  const edgeMap = new Map();
  relevant.forEach((rel) => {
    const fromTable = `${rel.from_schema}.${rel.from_table}`;
    const toTable = `${rel.to_schema}.${rel.to_table}`;

    const edge = document.createElementNS("http://www.w3.org/2000/svg", "line");
    edge.setAttribute("class", "diagram-edge");
    svg.appendChild(edge);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "diagram-edge-label");
    label.textContent = `${rel.from_column} → ${rel.to_column}`;
    svg.appendChild(label);

    edgeMap.set(`${fromTable}|${toTable}|${rel.from_column}|${rel.to_column}`, { edge, label, fromTable, toTable });
  });

  const updateEdges = () => {
    const viewportRect = viewport.getBoundingClientRect();

    edgeMap.forEach(({ edge, label, fromTable, toTable }) => {
      const fromEl = nodeMap.get(fromTable);
      const toEl = nodeMap.get(toTable);
      if (!fromEl || !toEl) return;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      const x1 = fromRect.left + fromRect.width / 2 - viewportRect.left + viewport.scrollLeft;
      const y1 = fromRect.top + fromRect.height / 2 - viewportRect.top + viewport.scrollTop;
      const x2 = toRect.left + toRect.width / 2 - viewportRect.left + viewport.scrollLeft;
      const y2 = toRect.top + toRect.height / 2 - viewportRect.top + viewport.scrollTop;

      edge.setAttribute("x1", String(x1));
      edge.setAttribute("y1", String(y1));
      edge.setAttribute("x2", String(x2));
      edge.setAttribute("y2", String(y2));

      label.setAttribute("x", String((x1 + x2) / 2));
      label.setAttribute("y", String((y1 + y2) / 2 - 5));
    });
  };

  const wireDrag = (node, tableName) => {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    node.addEventListener("pointerdown", (event) => {
      dragging = true;
      node.setPointerCapture(event.pointerId);
      const pos = positions.get(tableName);
      offsetX = event.clientX - pos.x;
      offsetY = event.clientY - pos.y;
      node.classList.add("dragging");
    });

    node.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const nextX = Math.max(8, event.clientX - offsetX);
      const nextY = Math.max(8, event.clientY - offsetY);
      positions.set(tableName, { x: nextX, y: nextY });
      updateNodePositions();
      updateEdges();
    });

    const stopDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      node.classList.remove("dragging");
      try {
        node.releasePointerCapture(event.pointerId);
      } catch {
        // noop
      }
    };

    node.addEventListener("pointerup", stopDrag);
    node.addEventListener("pointercancel", stopDrag);
  };

  nodeMap.forEach((node, tableName) => wireDrag(node, tableName));

  const maxWidth = Math.max(1100, layoutColumns * horizontalGap + 260);
  const maxHeight = Math.max(620, Math.ceil(tableNames.length / layoutColumns) * verticalGap + 260);
  nodesLayer.style.width = `${maxWidth}px`;
  nodesLayer.style.height = `${maxHeight}px`;
  svg.setAttribute("viewBox", `0 0 ${maxWidth} ${maxHeight}`);
  svg.setAttribute("width", String(maxWidth));
  svg.setAttribute("height", String(maxHeight));

  updateNodePositions();
  updateEdges();

  viewport.addEventListener("scroll", updateEdges);
  window.requestAnimationFrame(updateEdges);

  canvas.appendChild(viewport);
  count.textContent = `${tableNames.length} table(s), ${relevant.length} relation(s) • drag nodes to reorganize`;
  latestDiagramPayload = { generated_at: new Date().toISOString(), tables: tableNames, relationships: relevant, columns };
  document.getElementById("diagram-view-modal").classList.remove("hidden");
}

async function generateDiagram(connectionId) {
  const checked = Array.from(document.querySelectorAll('#diagram-table-picker input[type="checkbox"]:checked')).map(
    (el) => el.value
  );
  try {
    const data = await apiRequest(`/api/connections/${connectionId}/relationships`, {
      method: "POST",
      body: JSON.stringify({ tables: checked }),
    });
    renderRelationshipDiagram(data.relationships || [], checked, data.columns || []);
    closeDiagramModal();
    showSuccess("Relationship diagram opened.");
  } catch (err) {
    showError(err.message);
  }
}

function renderSchemaTree(connection, schemas = []) {
  const tree = document.getElementById("schema-tree");
  tree.innerHTML = "";

  const dbRoot = document.createElement("li");
  dbRoot.className = "db-root-node";

  const dbToggle = document.createElement("button");
  dbToggle.className = "tree-toggle db-root-toggle";
  const dbLabel = createNodeLabel("🗄️", `${connection.name} (${connection.engine})`, true);
  dbToggle.appendChild(dbLabel.wrap);

  const dbBody = document.createElement("div");
  dbBody.className = "db-root-body";

  dbToggle.addEventListener("click", () => {
    const hidden = dbBody.classList.toggle("hidden");
    dbLabel.caret.textContent = hidden ? "▸" : "▾";
  });

  dbToggle.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showDatabaseContextMenu({ x: e.clientX, y: e.clientY });
  });

  tree.append(dbRoot);
  dbRoot.append(dbToggle, dbBody);

  if (!schemas.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No schemas/tables/procedures found.";
    dbBody.appendChild(li);
    return;
  }

  schemas.forEach((schemaNode) => {
    const schemaLi = document.createElement("li");
    schemaLi.className = "schema-node";

    const schemaToggle = document.createElement("button");
    schemaToggle.className = "tree-toggle schema-toggle";
    const schemaLabel = createNodeLabel("🗂️", schemaNode.schema);
    schemaToggle.appendChild(schemaLabel.wrap);

    const schemaBody = document.createElement("div");
    schemaBody.className = "schema-body hidden";

    schemaToggle.addEventListener("click", () => {
      const hidden = schemaBody.classList.toggle("hidden");
      schemaLabel.caret.textContent = hidden ? "▸" : "▾";
      if (!hidden) {
        schemaLi.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }

      const sql = schemaStructureTemplate(currentEngine, schemaNode.schema);
      setEditorQuery(sql, `${schemaNode.schema}.schema`);
    });

    const tablesWrap = document.createElement("div");
    tablesWrap.className = "tree-group";
    const tablesToggle = document.createElement("button");
    tablesToggle.className = "tree-toggle tree-sub-toggle";
    const tablesLabel = createNodeLabel("📁", `Tables (${schemaNode.tables.length})`);
    tablesToggle.appendChild(tablesLabel.wrap);

    const tablesUl = document.createElement("ul");
    tablesUl.className = "tree-list hidden";
    tablesToggle.addEventListener("click", () => {
      const hidden = tablesUl.classList.toggle("hidden");
      tablesLabel.caret.textContent = hidden ? "▸" : "▾";
    });

    schemaNode.tables.forEach((table) => {
      const item = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "tree-leaf";
      btn.innerHTML = `<span class="tree-icon">📄</span><span>${table.name}</span>`;
      btn.addEventListener("click", () => {
        const sql = tableSelectTemplate(currentEngine, schemaNode.schema, table.name);
        setEditorQuery(sql, `${schemaNode.schema}.${table.name}`);
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
    tablesWrap.append(tablesToggle, tablesUl);
    schemaBody.appendChild(tablesWrap);

    const procsWrap = document.createElement("div");
    procsWrap.className = "tree-group";
    const procsToggle = document.createElement("button");
    procsToggle.className = "tree-toggle tree-sub-toggle";
    const procsLabel = createNodeLabel("📁", `Stored Procedures (${schemaNode.procedures.length})`);
    procsToggle.appendChild(procsLabel.wrap);

    const procsUl = document.createElement("ul");
    procsUl.className = "tree-list hidden";
    procsToggle.addEventListener("click", () => {
      const hidden = procsUl.classList.toggle("hidden");
      procsLabel.caret.textContent = hidden ? "▸" : "▾";
    });

    schemaNode.procedures.forEach((proc) => {
      const item = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "tree-leaf";
      btn.innerHTML = `<span class="tree-icon">⚙️</span><span>${proc.name}</span>`;
      btn.addEventListener("click", () => {
        const sql = procedureInspectTemplate(currentEngine, schemaNode.schema, proc.name);
        setEditorQuery(sql, `${schemaNode.schema}.${proc.name}`);
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
    procsWrap.append(procsToggle, procsUl);
    schemaBody.appendChild(procsWrap);

    schemaLi.append(schemaToggle, schemaBody);
    dbBody.appendChild(schemaLi);
  });
}


function closeDiagramViewModal() {
  document.getElementById("diagram-view-modal").classList.add("hidden");
}

function saveCurrentDiagram() {
  if (!latestDiagramPayload) {
    showError("No diagram to save yet.");
    return;
  }

  const blob = new Blob([JSON.stringify(latestDiagramPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `diagram-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showSuccess("Diagram JSON exported.");
}

function setupWorkspaceTabs() {
  const sqlBtn = document.getElementById("tab-sql");
  const savedBtn = document.getElementById("tab-saved");
  const sqlPane = document.getElementById("pane-sql");
  const savedPane = document.getElementById("pane-saved");

  activateWorkspaceTab = (which) => {
    const sqlActive = which === "sql";
    sqlBtn.classList.toggle("active", sqlActive);
    savedBtn.classList.toggle("active", !sqlActive);
    sqlPane.classList.toggle("hidden", !sqlActive);
    savedPane.classList.toggle("hidden", sqlActive);
  };

  sqlBtn.addEventListener("click", () => activateWorkspaceTab("sql"));
  savedBtn.addEventListener("click", () => activateWorkspaceTab("saved"));
}

async function loadSchemas(connection) {
  const data = await apiRequest(`/api/connections/${connection.id}/tables`);
  schemaTreeCache = data.schemas || [];
  renderSchemaTree(connection, schemaTreeCache);
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
        if (activateWorkspaceTab) activateWorkspaceTab("sql");
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
    if (String(user.role || "").toLowerCase() === "admin") {
      document.getElementById("users-link").classList.remove("hidden");
      document.getElementById("roles-link").classList.remove("hidden");
    } else {
      try {
        await apiRequest("/api/admin/users");
        document.getElementById("users-link").classList.remove("hidden");
      document.getElementById("roles-link").classList.remove("hidden");
      } catch {
        // not admin
      }
    }

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

    currentConnection = current;
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

    document.getElementById("diagram-close-btn").addEventListener("click", closeDiagramModal);
    document.getElementById("diagram-cancel-btn").addEventListener("click", closeDiagramModal);
    document.getElementById("diagram-modal").addEventListener("click", (e) => {
      if (e.target.id === "diagram-modal") closeDiagramModal();
    });
    document.getElementById("diagram-generate-btn").addEventListener("click", () => generateDiagram(connectionId));

    document.getElementById("diagram-view-close-btn").addEventListener("click", closeDiagramViewModal);
    document.getElementById("diagram-view-dismiss-btn").addEventListener("click", closeDiagramViewModal);
    document.getElementById("diagram-save-btn").addEventListener("click", saveCurrentDiagram);
    document.getElementById("diagram-view-modal").addEventListener("click", (e) => {
      if (e.target.id === "diagram-view-modal") closeDiagramViewModal();
    });

    setupWorkspaceTabs();

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

    await Promise.all([loadSchemas(current), loadSavedQueries(connectionId)]);
  } catch (err) {
    showError(err.message);
  }
})();
