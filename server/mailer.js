const { URL } = require("url");
const nodemailer = require("nodemailer");

let smtpTransport;

function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function hasSmtpConfig() {
  return Boolean(String(process.env.SMTP_HOST || "").trim());
}

function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;

  const host = String(process.env.SMTP_HOST || "").trim();
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = envBool("SMTP_SECURE", port === 465);
  const requireTls = envBool("SMTP_REQUIRE_TLS", false);
  const rejectUnauthorized = envBool("SMTP_TLS_REJECT_UNAUTHORIZED", false);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();

  smtpTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: requireTls,
    tls: { rejectUnauthorized },
    auth: user ? { user, pass } : undefined,
  });

  return smtpTransport;
}

function buildPasswordSetupMessage({ username, setupUrl, expiresHours }) {
  return {
    subject: "Your DB Wizard account is ready",
    text: `Hello ${username},\n\nYour DB Wizard account has been created.\nSet your password using this link: ${setupUrl}\n\nThis link expires in ${expiresHours} hour(s).`,
    html: `<p>Hello <strong>${username}</strong>,</p><p>Your DB Wizard account has been created.</p><p><a href="${setupUrl}">Set your password</a></p><p>This link expires in ${expiresHours} hour(s).</p>`,
  };
}

function buildUserInviteMessage({ inviteUrl, expiresMinutes }) {
  return {
    subject: "You are invited to DB Wizard",
    text: `You have been invited to join DB Wizard.\nCreate your account using this link: ${inviteUrl}\n\nThis link expires in ${expiresMinutes} minute(s).`,
    html: `<p>You have been invited to join DB Wizard.</p><p><a href="${inviteUrl}">Create your account</a></p><p>This link expires in ${expiresMinutes} minute(s).</p>`,
  };
}

async function deliverByWebhook({ to, from, subject, text, html, meta }) {
  const webhook = String(process.env.EMAIL_DELIVERY_WEBHOOK_URL || "").trim();
  if (!webhook) {
    return { delivered: false, reason: "EMAIL_DELIVERY_WEBHOOK_URL not configured" };
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
    body: JSON.stringify({ to, from, subject, text, html, meta }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Webhook email delivery failed (${response.status}): ${body || response.statusText}`);
  }

  return { delivered: true, channel: "webhook" };
}

async function deliverBySmtp({ to, from, subject, text, html }) {
  const transport = getSmtpTransport();
  if (!transport) return { delivered: false, reason: "SMTP not configured" };

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  return { delivered: true, channel: "smtp" };
}

async function deliverEmail(payload) {
  const smtpFirst = envBool("EMAIL_USE_SMTP", true);
  const channels = smtpFirst ? ["smtp", "webhook"] : ["webhook", "smtp"];

  let lastReason = "No delivery channel configured.";

  for (const channel of channels) {
    if (channel === "smtp") {
      const result = await deliverBySmtp(payload);
      if (result.delivered) return result;
      lastReason = result.reason || lastReason;
      continue;
    }

    if (channel === "webhook") {
      const result = await deliverByWebhook(payload);
      if (result.delivered) return result;
      lastReason = result.reason || lastReason;
    }
  }

  return { delivered: false, reason: lastReason };
}

async function sendInviteEmail({ to, username, setupUrl, expiresHours = 24 }) {
  const from = String(process.env.EMAIL_FROM || "no-reply@db-wizard.local").trim();
  const message = buildPasswordSetupMessage({ username, setupUrl, expiresHours });

  const delivery = await deliverEmail({
    to,
    from,
    subject: message.subject,
    text: message.text,
    html: message.html,
    meta: { type: "account_invite", username },
  });

  if (!delivery.delivered) {
    console.log(`[invite-email] no delivery channel configured. Invite link for ${to}: ${setupUrl}`);
    return { delivered: false, reason: delivery.reason, setupUrl };
  }

  return { delivered: true, channel: delivery.channel };
}

async function sendUserInviteEmail({ to, inviteUrl, expiresMinutes = 30 }) {
  const from = String(process.env.EMAIL_FROM || "no-reply@db-wizard.local").trim();
  const message = buildUserInviteMessage({ inviteUrl, expiresMinutes });

  const delivery = await deliverEmail({
    to,
    from,
    subject: message.subject,
    text: message.text,
    html: message.html,
    meta: { type: "user_invite" },
  });

  if (!delivery.delivered) {
    console.log(`[user-invite] no delivery channel configured. Invite link for ${to}: ${inviteUrl}`);
    return { delivered: false, reason: delivery.reason, inviteUrl };
  }

  return { delivered: true, channel: delivery.channel };
}

async function sendEmailConfirmation({ to, username, confirmUrl, expiresHours = 24 }) {
  const from = String(process.env.EMAIL_FROM || "no-reply@db-wizard.local").trim();
  const subject = "Confirm your DB Wizard email";
  const text = `Hello ${username},\n\nPlease confirm your email using this link: ${confirmUrl}\n\nThis link expires in ${expiresHours} hour(s).`;
  const html = `<p>Hello <strong>${username}</strong>,</p><p>Please confirm your email:</p><p><a href="${confirmUrl}">Confirm email</a></p><p>This link expires in ${expiresHours} hour(s).</p>`;

  const delivery = await deliverEmail({
    to,
    from,
    subject,
    text,
    html,
    meta: { type: "email_confirmation", username },
  });

  if (!delivery.delivered) {
    console.log(`[confirm-email] no delivery channel configured. Confirmation link for ${to}: ${confirmUrl}`);
    return { delivered: false, reason: delivery.reason, confirmUrl };
  }

  return { delivered: true, channel: delivery.channel };
}

module.exports = { sendInviteEmail, sendEmailConfirmation, sendUserInviteEmail };
