(async function initRegisterPage() {
  try {
    const me = await apiRequest("/api/me");
    if (me.user) {
      window.location.href = "/dashboard";
      return;
    }

    document.getElementById("register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
            const form = new FormData(e.target);
      try {
        await apiRequest("/api/register", {
          method: "POST",
          body: JSON.stringify({
            username: form.get("username"),
            email: form.get("email"),
            password: form.get("password"),
          }),
        });
        showSuccess("Registration submitted. Check your email and confirm before login.");
        setTimeout(() => {
          window.location.href = "/";
        }, 1200);
      } catch (err) {
        showError(err.message);
      }
    });
  } catch (err) {
    showError(err.message);
  }
})();
