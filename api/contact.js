/* eslint-disable @typescript-eslint/no-require-imports */

const {
  errorMessage,
  getAdminClient,
  getEnv,
  readRawBody,
  sendJson,
} = require("./billing/runtime.js");

const allowedQueryTypes = new Set([
  "Map Stories",
  "Local Guides",
  "Pricing or billing",
  "Partnerships",
  "Technical support",
  "Other",
]);

const defaultContactEmail = "contact@localmapr.com";

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendContactEmail({
  email,
  message,
  name,
  queryType,
  sourcePath,
  subject,
}) {
  const apiKey = getEnv("RESEND_API_KEY");
  const fromEmail = getEnv("CONTACT_FROM_EMAIL");
  const toEmail = getEnv("CONTACT_TO_EMAIL") || defaultContactEmail;

  if (!apiKey || !fromEmail) {
    return {
      emailId: null,
      error:
        "Email delivery is not configured. Add RESEND_API_KEY and CONTACT_FROM_EMAIL.",
    };
  }

  const escapedMessage = escapeHtml(message).replace(/\n/g, "<br />");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      reply_to: email,
      subject: `LocalMapr contact: ${subject}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Query type: ${queryType}`,
        `Subject: ${subject}`,
        sourcePath ? `Source: ${sourcePath}` : null,
        "",
        message,
      ]
        .filter(Boolean)
        .join("\n"),
      html: `
        <h2>New LocalMapr contact query</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Query type:</strong> ${escapeHtml(queryType)}</p>
        <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        ${sourcePath ? `<p><strong>Source:</strong> ${escapeHtml(sourcePath)}</p>` : ""}
        <hr />
        <p>${escapedMessage}</p>
      `,
    }),
  });

  if (!response.ok) {
    let detail = "";

    try {
      const payload = await response.json();
      detail = payload.message || payload.error || "";
    } catch {
      detail = await response.text();
    }

    return {
      emailId: null,
      error: detail || `Resend returned status ${response.status}.`,
    };
  }

  const payload = await response.json();
  return { emailId: payload.id ?? null, error: null };
}

async function updateContactEmailStatus(supabase, contactQueryId, patch) {
  if (!contactQueryId) {
    return;
  }

  try {
    const { error } = await supabase
      .from("contact_queries")
      .update(patch)
      .eq("id", contactQueryId);

    if (error) {
      console.error("Could not update contact email status", error);
    }
  } catch (error) {
    console.error("Contact email status update failed", error);
  }
}

async function handleContact(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  let payload = {};

  try {
    const body = await readRawBody(request);
    payload = JSON.parse(String(body || "{}"));
  } catch {
    sendJson(response, 400, { error: "Invalid request body." });
    return;
  }

  if (cleanText(payload.contactFaxNumber ?? payload.company, 200)) {
    sendJson(response, 200, {
      message: "Thanks, your query has been sent.",
    });
    return;
  }

  const name = cleanText(payload.name, 120);
  const email = cleanText(payload.email, 160).toLowerCase();
  const queryType = cleanText(payload.queryType, 80);
  const subject = cleanText(payload.subject, 140);
  const message = cleanText(payload.message, 4000);
  const sourcePath = cleanText(payload.sourcePath, 240) || null;
  const userAgent = cleanText(request.headers["user-agent"], 400) || null;

  if (!name) {
    sendJson(response, 400, { error: "Please enter your name." });
    return;
  }

  if (!email || !isEmail(email)) {
    sendJson(response, 400, { error: "Please enter a valid email address." });
    return;
  }

  if (!allowedQueryTypes.has(queryType)) {
    sendJson(response, 400, { error: "Please select a query type." });
    return;
  }

  if (!subject) {
    sendJson(response, 400, { error: "Please enter a subject." });
    return;
  }

  if (message.length < 10) {
    sendJson(response, 400, {
      error: "Please enter a message with a little more detail.",
    });
    return;
  }

  const { supabase, error: supabaseError } = getAdminClient();

  if (supabaseError || !supabase) {
    sendJson(response, 500, {
      error: supabaseError || "Contact storage is not configured.",
    });
    return;
  }

  let contactQueryId = null;

  try {
    const { data, error } = await supabase
      .from("contact_queries")
      .insert({
        email,
        message,
        name,
        query_type: queryType,
        source_path: sourcePath,
        subject,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (error) {
      sendJson(response, 500, {
        error: error.message || "Could not save your query.",
      });
      return;
    }

    contactQueryId = data?.id ?? null;
  } catch (error) {
    sendJson(response, 500, {
      error: errorMessage(error, "Could not save your query."),
    });
    return;
  }

  try {
    const emailResult = await sendContactEmail({
      email,
      message,
      name,
      queryType,
      sourcePath,
      subject,
    });

    if (emailResult.error) {
      await updateContactEmailStatus(supabase, contactQueryId, {
        email_error: emailResult.error,
        email_status: "failed",
      });

      sendJson(response, 500, { error: emailResult.error });
      return;
    }

    await updateContactEmailStatus(supabase, contactQueryId, {
      email_error: null,
      email_provider_id: emailResult.emailId,
      email_sent_at: new Date().toISOString(),
      email_status: "sent",
    });
  } catch (error) {
    await updateContactEmailStatus(supabase, contactQueryId, {
      email_error: errorMessage(error, "Could not send your query email."),
      email_status: "failed",
    });

    sendJson(response, 500, {
      error: errorMessage(error, "Could not send your query email."),
    });
    return;
  }

  sendJson(response, 200, {
    message: "Thanks, your query has been sent.",
  });
}

module.exports = async function handler(request, response) {
  try {
    await handleContact(request, response);
  } catch (error) {
    console.error("contact handler failed:", error);
    sendJson(response, 500, {
      error: errorMessage(error, "Contact form failed unexpectedly."),
    });
  }
};
