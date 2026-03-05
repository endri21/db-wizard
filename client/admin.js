(async function initAdmin() {
  try {
    const me = await requireUserOrRedirect();
    if (!me) return;
    if (String(me.role || "").toLowerCase() !== "admin") {
      window.location.href = "/dashboard";
      return;
    }

    window.location.href = "/users";
  } catch (err) {
    showError(err.message);
  }
})();
