const { useEffect, useState } = React;

function App() {
  const [user, setUser] = useState(null);
  const [providers, setProviders] = useState({});
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tables, setTables] = useState([]);
  const [query, setQuery] = useState("SELECT 1 as ok");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [registerForm, setRegisterForm] = useState({ username: "", password: "" });
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [connForm, setConnForm] = useState({
    name: "",
    engine: "sqlite",
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
    setResult(null);
  };

  const saveConnection = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await request("/api/connections", { method: "POST", body: JSON.stringify(connForm) });
      setConnForm({
        name: "",
        engine: "sqlite",
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
    setError("");
    try {
      await loadTables(connection);
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

  if (!user) {
    return (
      <div className="container narrow">
        <h1>DB Wizard (Node + React)</h1>
        <p>Login with username/password or your organization login.</p>
        {error && <p className="error">{error}</p>}

        <div className="panel">
          <h2>Login</h2>
          <form onSubmit={login}>
            <label>
              Username
              <input value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
            </label>
            <label>
              Password
              <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
            </label>
            <button>Login</button>
          </form>
        </div>

        <div className="panel">
          <h2>Register</h2>
          <form onSubmit={register}>
            <label>
              Username
              <input value={registerForm.username} onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })} />
            </label>
            <label>
              Password
              <input type="password" value={registerForm.password} onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })} />
            </label>
            <button>Register</button>
          </form>
        </div>

        <div className="panel">
          <h2>Organization login (OAuth)</h2>
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
    );
  }

  return (
    <div className="container">
      <header className="topbar">
        <h1>Manage Databases</h1>
        <div>
          Signed in as <b>{user.username}</b> <button onClick={logout}>Logout</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>Add Connection</h2>
        <form onSubmit={saveConnection} className="grid two-col">
          <label>Connection Name<input value={connForm.name} onChange={(e) => setConnForm({ ...connForm, name: e.target.value })} /></label>
          <label>Engine
            <select value={connForm.engine} onChange={(e) => setConnForm({ ...connForm, engine: e.target.value })}>
              <option value="sqlite">SQLite</option>
              <option value="postgresql">PostgreSQL</option>
              <option value="mysql">MySQL</option>
              <option value="mssql">MSSQL</option>
            </select>
          </label>
          <label className="full">Connection String<input value={connForm.connection_string} onChange={(e) => setConnForm({ ...connForm, connection_string: e.target.value })} /></label>
          <p className="full muted">Or server credentials:</p>
          <label>Server<input value={connForm.server} onChange={(e) => setConnForm({ ...connForm, server: e.target.value })} /></label>
          <label>Port<input value={connForm.port} onChange={(e) => setConnForm({ ...connForm, port: e.target.value })} /></label>
          <label>Database<input value={connForm.database_name} onChange={(e) => setConnForm({ ...connForm, database_name: e.target.value })} /></label>
          <label>DB Username<input value={connForm.db_username} onChange={(e) => setConnForm({ ...connForm, db_username: e.target.value })} /></label>
          <label className="full">DB Password<input type="password" value={connForm.db_password} onChange={(e) => setConnForm({ ...connForm, db_password: e.target.value })} /></label>
          <button className="full">Save</button>
        </form>
      </section>

      <div className="workspace">
        <aside className="panel sidebar">
          <h3>Connections</h3>
          <ul>
            {connections.map((c) => (
              <li key={c.id}><button onClick={() => openConnection(c)}>{c.name} ({c.engine})</button></li>
            ))}
          </ul>

          <h3>Tables</h3>
          <ul>
            {tables.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </aside>

        <main className="panel">
          <h3>Query Runner</h3>
          {!selected && <p>Select a connection first.</p>}
          {selected && (
            <>
              <textarea rows="8" value={query} onChange={(e) => setQuery(e.target.value)} />
              <button onClick={runSimpleQuery}>Run (read-only)</button>
            </>
          )}

          {result && (
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
          )}
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
