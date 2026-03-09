const { URL } = require("url");

function buildPasswordSetupMessage({ username, setupUrl, expiresHours }) {
  return {
    subject: "Your DB Wizard account is ready",
    text: `Hello ${username},\n\nYour DB Wizard account has been created.\nSet your password using this link: ${setupUrl}\n\nThis link expires in ${expiresHours} hour(s).`,
    html: `<p>Hello <strong>${username}</strong>,</p><p>Your DB Wizard account has been created.</p><p><a href="${setupUrl}">Set your password</a></p><p>This link expires in ${expiresHours} hour(s).</p>`,
  };
}

async function sendInviteEmail({ to, username, setupUrl, expiresHours = 24 }) {
  const webhook = String(process.env.EMAIL_DELIVERY_WEBHOOK_URL || "").trim();
  const from = String(process.env.EMAIL_FROM || "no-reply@db-wizard.local").trim();
  const message = buildPasswordSetupMessage({ username, setupUrl, expiresHours });

  if (!webhook) {
    console.log(`[invite-email] webhook not configured. Invite link for ${to}: ${setupUrl}`);
    return { delivered: false, reason: "EMAIL_DELIVERY_WEBHOOK_URL not configured", setupUrl };
  }

  let parsed;
  try {
    parsed = new URL(webhook);
  } catch {
    throw new Error("EMAIL_DELIVERY_WEBHOOK_URL is invalid.");
  }

  const response = await fetch(parsed.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      to,
      from,
      subject: message.subject,
      text: message.text,
      html: message.html,
      meta: { type: "account_invite", username },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Invite delivery failed (${response.status}): ${body || response.statusText}`);
  }

  return { delivered: true };
}

async function sendEmailConfirmation({ to, username, confirmUrl, expiresHours = 24 }) {
  const webhook = String(process.env.EMAIL_DELIVERY_WEBHOOK_URL || "").trim();
  const from = String(process.env.EMAIL_FROM || "no-reply@db-wizard.local").trim();
  const subject = "Confirm your DB Wizard email";
  const text = `Hello ${username},\n\nPlease confirm your email using this link: ${confirmUrl}\n\nThis link expires in ${expiresHours} hour(s).`;
  const html = `<p>Hello <strong>${username}</strong>,</p><p>Please confirm your email:</p><p><a href="${confirmUrl}">Confirm email</a></p><p>This link expires in ${expiresHours} hour(s).</p>`;

  if (!webhook) {
    console.log(`[confirm-email] webhook not configured. Confirmation link for ${to}: ${confirmUrl}`);
    return { delivered: false, reason: "EMAIL_DELIVERY_WEBHOOK_URL not configured", confirmUrl };
  }

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, from, subject, text, html, meta: { type: "email_confirmation", username } }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email confirmation delivery failed (${response.status}): ${body || response.statusText}`);
  }

  return { delivered: true };
}

module.exports = { sendInviteEmail, sendEmailConfirmation };
