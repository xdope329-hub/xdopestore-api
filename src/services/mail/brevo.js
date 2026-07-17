// Thin wrapper around the Brevo HTTPS API. Uses native fetch (Node 20+).
// Docs: https://developers.brevo.com/reference/sendtransacemail
//        https://developers.brevo.com/reference/createcontact
const BREVO_BASE = 'https://api.brevo.com/v3';

function apiKey() {
  return process.env.BREVO_API_KEY;
}

function isConfigured() {
  return Boolean(apiKey());
}

async function brevoRequest(path, method, body) {
  if (!isConfigured()) {
    const err = new Error('BREVO_API_KEY is not set');
    err.code = 'BREVO_NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(`${BREVO_BASE}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data.message || `Brevo ${method} ${path} failed with ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function sender() {
  return {
    email: process.env.BREVO_SENDER_EMAIL || 'no-reply@xdope.com',
    name: process.env.BREVO_SENDER_NAME || 'xDope Store',
  };
}

// to: string | { email, name } | Array<either>
function normalizeRecipients(to) {
  const arr = Array.isArray(to) ? to : [to];
  return arr
    .filter(Boolean)
    .map((r) => (typeof r === 'string' ? { email: r } : { email: r.email, name: r.name }));
}

async function sendTransactionalEmail({ to, subject, htmlContent, textContent, params, templateId, replyTo }) {
  const payload = {
    sender: sender(),
    to: normalizeRecipients(to),
    subject,
  };
  if (templateId) {
    payload.templateId = Number(templateId);
    if (params) payload.params = params;
  } else {
    payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;
  }
  if (replyTo) payload.replyTo = typeof replyTo === 'string' ? { email: replyTo } : replyTo;
  return brevoRequest('/smtp/email', 'POST', payload);
}

// Adds a contact to Brevo. If listId is given, subscribes to that list.
// `updateEnabled: true` avoids errors if the contact already exists.
async function addContactToList({ email, attributes, listId }) {
  const body = {
    email,
    updateEnabled: true,
  };
  if (attributes) body.attributes = attributes;
  if (listId) body.listIds = [Number(listId)];
  return brevoRequest('/contacts', 'POST', body);
}

module.exports = { sendTransactionalEmail, addContactToList, isConfigured };
