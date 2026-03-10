const { useEffect, useMemo, useState } = React;

function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="footer-top-links">
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer">About</a>
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer">Products</a>
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer">Services</a>
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer">Help</a>
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer">Contact</a>
      </div>
      <p className="footer-copy">Yagni Technologies builds practical data platforms and tools that keep teams focused on value.</p>
      <div className="footer-social">
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer" aria-label="Facebook">f</a>
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer" aria-label="Twitter">t</a>
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">in</a>
        <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer" aria-label="GitHub">gh</a>
      </div>
      <div className="footer-bottom">© {new Date().getFullYear()} Copyright: <a href="https://yagni.pro" target="_blank" rel="noopener noreferrer">yagni.pro</a></div>
    </footer>
  );
}

function UsersApp() {
  const [me, setMe] = useState(null);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [busyLabel, setBusyLabel] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [activeUser, setActiveUser] = useState(null);

  const [createForm, setCreateForm] = useState({ email: "", role: "user", max_connections: 5 });
  const [editForm, setEditForm] = useState({ id: "", username: "", provider: "", role: "user", max_connections: 5 });
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);

  const roleOptions = useMemo(() => roles.map((r) => r.name), [roles]);

  async function loadAll(label = "Loading users…") {
    setBusyLabel(label);
    try {
      const [nextRoles, nextUsers] = await Promise.all([
        apiRequest("/api/admin/roles"),
        apiRequest("/api/admin/users"),
      ]);
      setRoles(nextRoles);
      setUsers(nextUsers);
      setForbidden(false);
    } catch {
      setForbidden(true);
    } finally {
      setBusyLabel("");
    }
  }

  useEffect(() => {
    (async () => {
      const current = await requireUserOrRedirect();
      if (!current) return;
      setMe(current);
      await loadAll();
    })();
  }, []);

  async function onLogout() {
    await apiRequest("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  function openCreate() {
    setCreateForm({ email: "", role: roleOptions[0] || "user", max_connections: 5 });
    setCreateOpen(true);
  }

  function openEdit(user) {
    setEditForm({
      id: user.id,
      username: user.username,
      provider: user.provider,
      role: user.role,
      max_connections: user.max_connections,
    });
    setEditOpen(true);
  }

  function openDelete(user) {
    if (Number(user.id) === Number(me?.id)) {
      showError("You cannot delete your own account.");
      return;
    }
    setActiveUser(user);
    const blocked = Number(user.connection_count || 0) > 0;
    setDeleteBlocked(blocked);
    setDeleteOpen(true);
  }

  async function submitInvite(e) {
    e.preventDefault();
    setLoadingInvite(true);
    setBusyLabel("Sending invitation email…");
    try {
      const created = await apiRequest("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify(createForm),
      });
      await loadAll("");
      setCreateOpen(false);
      if (created?.invitation?.invite_url) {
        const state = created.invitation.delivered ? "Invite email sent." : "Invite link created (delivery not configured).";
        showSuccess(`${state} Invite URL: ${created.invitation.invite_url}`);
      } else {
        showSuccess("Invite created.");
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setLoadingInvite(false);
      setBusyLabel("");
    }
  }

  async function submitEdit(e) {
    e.preventDefault();
    setLoadingEdit(true);
    setBusyLabel("Updating user…");
    try {
      await apiRequest(`/api/admin/users/${editForm.id}`, {
        method: "PUT",
        body: JSON.stringify({
          role: editForm.role,
          max_connections: Number(editForm.max_connections),
        }),
      });
      await loadAll("");
      setEditOpen(false);
      showSuccess("User updated.");
    } catch (err) {
      showError(err.message);
    } finally {
      setLoadingEdit(false);
      setBusyLabel("");
    }
  }

  async function confirmDelete() {
    if (!activeUser || deleteBlocked) return;
    setLoadingDelete(true);
    setBusyLabel("Deleting user…");
    try {
      await apiRequest(`/api/admin/users/${activeUser.id}`, { method: "DELETE" });
      await loadAll("");
      setDeleteOpen(false);
      setActiveUser(null);
      showSuccess("User deleted.");
    } catch (err) {
      showError(err.message);
    } finally {
      setLoadingDelete(false);
      setBusyLabel("");
    }
  }

  if (!me) return null;

  return (
    <>
      <div className="app-frame">
        <aside className="side-nav">
          <div className="side-nav-brand">DB Wizard</div>
          <nav className="side-nav-links">
            <a className="side-link" href="/dashboard">Dashboard</a>
            <a className="side-link active" href="/users">Users</a>
            <a className="side-link" href="/roles">Roles</a>
          </nav>
        </aside>

        <div className="app-shell portal-shell">
          <header className="app-header portal-header">
            <div className="brand-wrap">
              <div className="brand-badge">DB</div>
              <div>
                <h1>User Management (React)</h1>
                <p className="muted">Create users and set role + max DB workspaces</p>
              </div>
            </div>
            <div className="header-actions">
              <span className="chip">Signed in: {me.username}</span>
              <button onClick={onLogout} className="secondary">Logout</button>
            </div>
          </header>

          <main className="panel portal-content portal-content-full">
            {busyLabel ? (
              <div className="loading-overlay" aria-live="polite">
                <div className="spinner"></div>
                <span>{busyLabel}</span>
              </div>
            ) : null}

            {forbidden ? (
              <p className="warning-text">Admin access required to manage users.</p>
            ) : (
              <div>
                <div className="portal-section-header section-actions" style={{ marginBottom: ".55rem" }}>
                  <div></div>
                  <button type="button" className="btn-small" onClick={openCreate}>+ Invite User</button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>ID</th><th>Username</th><th>Email</th><th>Provider</th><th>Role</th><th>Current DBs</th><th>Max DBs</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.id}</td><td>{u.username}</td><td>{u.email || "-"}</td><td>{u.provider}</td><td>{u.role}</td><td>{u.connection_count}</td><td>{u.max_connections}</td>
                          <td>
                            <div className="row-actions">
                              <button type="button" className="secondary btn-small" onClick={() => openEdit(u)}>Edit</button>
                              <button type="button" className="danger btn-small" disabled={Number(u.id) === Number(me.id)} onClick={() => openDelete(u)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {createOpen ? (
        <div className="modal" onClick={(e) => e.target.classList.contains("modal") && setCreateOpen(false)}>
          <div className="modal-card panel confirm-modal">
            <div className="modal-header">
              <h3>Invite User</h3>
              <button className="icon-close" type="button" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <form className="grid" style={{ gap: ".6rem" }} onSubmit={submitInvite}>
              <label>Email<input type="email" required value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} /></label>
              <label>Role
                <select required value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}>
                  {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label>Max DBs<input type="number" min="1" max="200" required value={createForm.max_connections} onChange={(e) => setCreateForm({ ...createForm, max_connections: Number(e.target.value) })} /></label>
              <p className="muted" style={{ margin: 0 }}>An invite link will be emailed and expires in 30 minutes.</p>
              <div className="actions-row">
                <button type="submit" disabled={loadingInvite}>{loadingInvite ? "Sending…" : "Send Invite"}</button>
                <button type="button" className="secondary" onClick={() => setCreateOpen(false)} disabled={loadingInvite}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="modal" onClick={(e) => e.target.classList.contains("modal") && setEditOpen(false)}>
          <div className="modal-card panel confirm-modal">
            <div className="modal-header">
              <h3>Edit User</h3>
              <button className="icon-close" type="button" onClick={() => setEditOpen(false)}>✕</button>
            </div>
            <form className="grid" style={{ gap: ".6rem" }} onSubmit={submitEdit}>
              <label>Username<input readOnly value={editForm.username} /></label>
              <label>Provider<input readOnly value={editForm.provider} /></label>
              <label>Role
                <select required value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                  {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label>Max DBs<input type="number" min="1" max="200" required value={editForm.max_connections} onChange={(e) => setEditForm({ ...editForm, max_connections: Number(e.target.value) })} /></label>
              <div className="actions-row">
                <button type="submit" disabled={loadingEdit}>{loadingEdit ? "Updating…" : "Update User"}</button>
                <button type="button" className="secondary" onClick={() => setEditOpen(false)} disabled={loadingEdit}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="modal" onClick={(e) => e.target.classList.contains("modal") && setDeleteOpen(false)}>
          <div className="modal-card panel confirm-modal">
            <div className="modal-header">
              <h3>Delete User</h3>
              <button className="icon-close" type="button" onClick={() => setDeleteOpen(false)}>✕</button>
            </div>
            <p className="muted" style={{ margin: ".2rem 0 .8rem" }}>
              {deleteBlocked
                ? `${activeUser?.username || "User"} cannot be deleted yet because they still have ${activeUser?.connection_count || 0} database connection(s).`
                : `Delete ${activeUser?.username || "user"} (${activeUser?.email || "no-email"})?`}
            </p>
            <p className="warning-text" style={{ marginTop: 0 }}>This action cannot be undone.</p>
            <div className="actions-row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="danger btn-small" onClick={confirmDelete} disabled={deleteBlocked || loadingDelete}>{loadingDelete ? "Deleting…" : "Delete"}</button>
              <button type="button" className="secondary btn-small" onClick={() => setDeleteOpen(false)} disabled={loadingDelete}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      <AppFooter />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("users-react-root")).render(<UsersApp />);
