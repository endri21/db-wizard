(async function initConfirmEmail() {
  const params = new URLSearchParams(window.location.search);
  const token = String(params.get("token") || "").trim();
  const hint = document.getElementById("confirm-email-hint");
  const button = document.getElementById("confirm-email-btn");

  if (!token) {
    hint.textContent = "Invalid confirmation link.";
    return;
  }

  try {
    const payload = await apiRequest("/api/email-confirm/validate", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    hint.textContent = `Confirm account: ${payload.username}${payload.email ? ` (${payload.email})` : ""}`;
    button.classList.remove("hidden");
  } catch (err) {
    hint.textContent = err.message || "Unable to validate this confirmation link.";
    return;
  }

  button.addEventListener("click", async () => {
    try {
      await apiRequest("/api/email-confirm/complete", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      showSuccess("Email confirmed. Redirecting to sign in...");
      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
    } catch (err) {
      showError(err.message);
    }
  });
})();
