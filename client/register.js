(async function initRegisterPage() {
  try {
    const me = await apiRequest("/api/me");
    if (me.user) {
      window.location.href = "/dashboard";
      return;
    }

    const inviteToken = String(new URLSearchParams(window.location.search).get("invite") || "").trim();
    if (inviteToken) {
      try {
        const invite = await apiRequest("/api/invites/validate", {
          method: "POST",
          body: JSON.stringify({ token: inviteToken }),
        });
        document.getElementById("invite-token").value = inviteToken;
        const emailInput = document.querySelector('input[name="email"]');
        emailInput.value = invite.email || "";
        emailInput.readOnly = true;
        showSuccess(`Invite loaded for ${invite.email}.`);
      } catch (err) {
        showError(err.message);
      }
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
            invite_token: form.get("invite_token"),
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
