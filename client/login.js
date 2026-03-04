(async function initLoginPage() {
  try {
    const me = await apiRequest("/api/me");
    if (me.user) {
      window.location.href = "/dashboard";
      return;
    }

    const providers = await apiRequest("/api/auth/providers");
    const oauthButtons = document.getElementById("oauth-buttons");
    Object.entries(providers)
      .filter(([, enabled]) => enabled)
      .forEach(([provider]) => {
        const a = document.createElement("a");
        a.className = "button";
        a.href = `/auth/${provider}`;
        a.textContent = `Continue with ${provider}`;
        oauthButtons.appendChild(a);
      });

    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("");
      const form = new FormData(e.target);
      try {
        await apiRequest("/api/login", {
          method: "POST",
          body: JSON.stringify({
            username: form.get("username"),
            password: form.get("password"),
          }),
        });
        window.location.href = "/dashboard";
      } catch (err) {
        showError(err.message);
      }
    });

    document.getElementById("register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("");
      const form = new FormData(e.target);
      try {
        await apiRequest("/api/register", {
          method: "POST",
          body: JSON.stringify({
            username: form.get("username"),
            password: form.get("password"),
          }),
        });
        showError("Registration successful. Please sign in.");
        e.target.reset();
      } catch (err) {
        showError(err.message);
      }
    });
  } catch (err) {
    showError(err.message);
  }
})();
