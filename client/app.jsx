const { useEffect, useState } = React;

function App() {
  const [user, setUser] = useState(null);
  const [providers, setProviders] = useState({});
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tables, setTables] = useState([]);
  const [savedQueries, setSavedQueries] = useState([]);
  const [editingSavedQueryId, setEditingSavedQueryId] = useState(null);
  const [queryName, setQueryName] = useState("");
  const [query, setQuery] = useState("SELECT 1 as ok");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [registerForm, setRegisterForm] = useState({ username: "", password: "" });
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [connForm, setConnForm] = useState({
    name: "",
    engine: "postgresql",
    connection_string: "",
    server: "",
    port: "",
    database_name: "",
    db_username: "",
    db_password: "",
  });

  const request = async (url, options = {}) => {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      ...options,
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Request failed");
    return payload;
  };

  const loadMe = async () => {
    const me = await request("/api/me");
    setUser(me.user);
  };

  const loadProviders = async () => {
    const data = await request("/api/auth/providers");
    setProviders(data);
  };

  const loadConnections = async () => {
    if (!user) return;
    const data = await request("/api/connections");
    setConnections(data);
  };

  const loadTables = async (connection) => {
    const data = await request(`/api/connections/${connection.id}/tables`);
    setTables(data.tables || []);
  };

  const loadSavedQueries = async (connection) => {
    const data = await request(`/api/connections/${connection.id}/saved-queries`);
    setSavedQueries(data);
  };

  useEffect(() => {
    loadProviders().catch((e) => setError(e.message));
    loadMe().catch(() => {});
  }, []);

  useEffect(() => {
    loadConnections().catch(() => {});
  }, [user]);

  const register = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await request("/api/register", { method: "POST", body: JSON.stringify(registerForm) });
      alert("Registration successful. Now login.");
      setRegisterForm({ username: "", password: "" });
    } catch (err) {
      setError(err.message);
    }
  };

  const login = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await request("/api/login", { method: "POST", body: JSON.stringify(loginForm) });
      await loadMe();
      setLoginForm({ username: "", password: "" });
    } catch (err) {
      setError(err.message);
    }
  };

  const logout = async () => {
    await request("/api/logout", { method: "POST" });
    setUser(null);
    setConnections([]);
    setSelected(null);
    setTables([]);
    setSavedQueries([]);
    setResult(null);
  };

  const saveConnection = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await request("/api/connections", { method: "POST", body: JSON.stringify(connForm) });
      setConnForm({
        name: "",
        engine: "postgresql",
        connection_string: "",
        server: "",
        port: "",
        database_name: "",
        db_username: "",
        db_password: "",
      });
      await loadConnections();
    } catch (err) {
      setError(err.message);
    }
  };

  const openConnection = async (connection) => {
    setSelected(connection);
    setResult(null);
    setEditingSavedQueryId(null);
    setQueryName("");
    setError("");
    try {
      await Promise.all([loadTables(connection), loadSavedQueries(connection)]);
    } catch (err) {
      setError(err.message);
    }
  };

  const runSimpleQuery = async () => {
    if (!selected) return;
    setError("");
    try {
      const data = await request(`/api/connections/${selected.id}/query`, {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const saveCurrentQuery = async () => {
    if (!selected) return;
    setError("");
    try {
      if (editingSavedQueryId) {
        await request(`/api/connections/${selected.id}/saved-queries/${editingSavedQueryId}`, {
          method: "PUT",
          body: JSON.stringify({ name: queryName, sql_text: query }),
        });
      } else {
        await request(`/api/connections/${selected.id}/saved-queries`, {
          method: "POST",
          body: JSON.stringify({ name: queryName, sql_text: query }),
        });
      }
      await loadSavedQueries(selected);
      setEditingSavedQueryId(null);
      setQueryName("");
    } catch (err) {
      setError(err.message);
    }
  };

  const loadSavedQueryIntoEditor = (item) => {
    setEditingSavedQueryId(item.id);
    setQueryName(item.name);
    setQuery(item.sql_text);
  };

  const deleteSavedQuery = async (id) => {
    if (!selected) return;
    setError("");
    try {
      await request(`/api/connections/${selected.id}/saved-queries/${id}`, { method: "DELETE" });
      await loadSavedQueries(selected);
      if (editingSavedQueryId === id) {
        setEditingSavedQueryId(null);
        setQueryName("");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const runSavedQuery = async (item) => {
    if (!selected) return;
    setError("");
    try {
      const data = await request(`/api/connections/${selected.id}/saved-queries/${item.id}/run`, {
        method: "POST",
      });
      setResult(data);
      setQuery(item.sql_text);
      setQueryName(item.name);
      setEditingSavedQueryId(item.id);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>DB Wizard</h1>
          <p className="muted">Enterprise database access workspace</p>
          {error && <p className="error">{error}</p>}
          <div className="auth-grid">
            <div className="panel">
              <h2>Login</h2>
              <form onSubmit={login}>
                <label>Username<input value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} /></label>
                <label>Password<input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} /></label>
                <button>Login</button>
              </form>
            </div>
            <div className="panel">
              <h2>Register</h2>
              <form onSubmit={register}>
                <label>Username<input value={registerForm.username} onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })} /></label>
                <label>Password<input type="password" value={registerForm.password} onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })} /></label>
                <button>Create account</button>
              </form>
            </div>
          </div>
          <div className="panel">
            <h2>Organization Login</h2>
            <div className="oauth-buttons">
              {Object.entries(providers)
                .filter(([, enabled]) => enabled)
                .map(([provider]) => (
                  <a key={provider} className="button" href={`/auth/${provider}`}>
                    Continue with {provider}
                  </a>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>DB Wizard</h1>
          <p className="muted">Data Platform Console</p>
        </div>
        <div className="header-actions">
          <span className="chip">Signed in: {user.username}</span>
          <button className="secondary" onClick={logout}>Logout</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="panel connection-panel">
        <h2>Add Connection</h2>
        <form onSubmit={saveConnection} className="grid two-col">
          <label>Connection Name<input value={connForm.name} onChange={(e) => setConnForm({ ...connForm, name: e.target.value })} /></label>
          <label>Engine
            <select value={connForm.engine} onChange={(e) => setConnForm({ ...connForm, engine: e.target.value })}>
              <option value="postgresql">PostgreSQL</option>
              <option value="mysql">MySQL</option>
              <option value="mssql">MSSQL</option>
            </select>
          </label>
          <label className="full">Connection String<input value={connForm.connection_string} onChange={(e) => setConnForm({ ...connForm, connection_string: e.target.value })} /></label>
          <p className="full muted">Use connection string or server credentials below.</p>
          <label>Server<input value={connForm.server} onChange={(e) => setConnForm({ ...connForm, server: e.target.value })} /></label>
          <label>Port<input value={connForm.port} onChange={(e) => setConnForm({ ...connForm, port: e.target.value })} /></label>
          <label>Database<input value={connForm.database_name} onChange={(e) => setConnForm({ ...connForm, database_name: e.target.value })} /></label>
          <label>DB Username<input value={connForm.db_username} onChange={(e) => setConnForm({ ...connForm, db_username: e.target.value })} /></label>
          <label className="full">DB Password<input type="password" value={connForm.db_password} onChange={(e) => setConnForm({ ...connForm, db_password: e.target.value })} /></label>
          <button className="full">Save Connection</button>
        </form>
      </section>

      <section className="workspace-enterprise">
        <aside className="panel left-rail">
          <h3>Connections</h3>
          <ul className="nav-list">
            {connections.map((c) => (
              <li key={c.id}>
                <button className={selected?.id === c.id ? "active" : ""} onClick={() => openConnection(c)}>{c.name} ({c.engine})</button>
              </li>
            ))}
            {!connections.length && <li className="muted">No connections yet.</li>}
          </ul>

          <h3>Tables</h3>
          <ul className="nav-list table-list">
            {tables.map((t) => <li key={t}>{t}</li>)}
            {!tables.length && <li className="muted">Select a connection to load tables.</li>}
          </ul>
        </aside>

        <main className="panel ide-panel">
          <div className="ide-header">
            <h3>SQL IDE</h3>
            {selected ? <span className="chip">Connection: {selected.name}</span> : <span className="chip">No connection selected</span>}
          </div>

          {!selected && <p className="muted">Select a connection to start querying.</p>}
          {selected && (
            <>
              <label>Query Name
                <input value={queryName} onChange={(e) => setQueryName(e.target.value)} placeholder="e.g. Monthly Revenue" />
              </label>

              <textarea className="sql-editor" rows="10" value={query} onChange={(e) => setQuery(e.target.value)} />

              <div className="actions-row">
                <button onClick={runSimpleQuery}>Run Query</button>
                <button className="secondary" onClick={saveCurrentQuery}>{editingSavedQueryId ? "Update Saved" : "Save Query"}</button>
              </div>

              <h4>Saved Queries</h4>
              <ul className="saved-query-list">
                {savedQueries.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <p className="muted">{item.sql_text.slice(0, 140)}</p>
                    </div>
                    <div className="actions-row">
                      <button className="secondary" onClick={() => loadSavedQueryIntoEditor(item)}>Load</button>
                      <button onClick={() => runSavedQuery(item)}>Run</button>
                      <button className="danger" onClick={() => deleteSavedQuery(item.id)}>Delete</button>
                    </div>
                  </li>
                ))}
                {!savedQueries.length && <li className="muted">No saved queries yet.</li>}
              </ul>
            </>
          )}

          {result && (
            <div className="result-wrap">
              <h4>Result</h4>
              <table>
                <thead>
                  <tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, idx) => (
                    <tr key={idx}>{result.columns.map((c) => <td key={c}>{String(row[c] ?? "")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
