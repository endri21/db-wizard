(async function initRegisterPage() {
  try {
    const me = await apiRequest("/api/me");
    if (me.user) {
      window.location.href = "/dashboard";
      return;
    }

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
        window.location.href = "/?registered=1";
      } catch (err) {
        showError(err.message);
      }
    });
  } catch (err) {
    showError(err.message);
  }
})();
