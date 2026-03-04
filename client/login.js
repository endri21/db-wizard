(async function initLoginPage() {
  try {
    const me = await apiRequest("/api/me");
    if (me.user) {
      window.location.href = "/dashboard";
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("registered")) {
      showSuccess("Account created successfully. Please sign in.");
    }

    const providers = await apiRequest("/api/auth/providers");
    const oauthButtons = document.getElementById("oauth-buttons");
    Object.entries(providers)
      .filter(([, enabled]) => enabled)
      .forEach(([provider]) => {
        const a = document.createElement("a");
        a.className = "button secondary";
        a.href = `/auth/${provider}`;
        a.textContent = `Continue with ${provider}`;
        oauthButtons.appendChild(a);
      });

    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
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
  } catch (err) {
    showError(err.message);
  }
})();
