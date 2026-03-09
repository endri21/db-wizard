(function initSetPassword() {
  const params = new URLSearchParams(window.location.search);
  const token = String(params.get("token") || "").trim();
  const hint = document.getElementById("setup-user-hint");
  const form = document.getElementById("set-password-form");

  if (!token) {
    hint.textContent = "Invalid password setup link.";
    return;
  }

  async function validateToken() {
    try {
      const data = await apiRequest("/api/password-setup/validate", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      hint.textContent = `Account: ${data.username}${data.email ? ` (${data.email})` : ""}`;
      form.classList.remove("hidden");
    } catch (err) {
      hint.textContent = err.message || "Unable to validate this setup link.";
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("new-password").value;
    const pw2 = document.getElementById("confirm-password").value;
    if (pw !== pw2) {
      showError("Passwords do not match.");
      return;
    }

    try {
      await apiRequest("/api/password-setup/complete", {
        method: "POST",
        body: JSON.stringify({ token, password: pw }),
      });
      showSuccess("Password set successfully. Redirecting to login...");
      setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch (err) {
      showError(err.message);
    }
  });

  validateToken();
})();
