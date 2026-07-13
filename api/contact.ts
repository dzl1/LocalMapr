import {
  errorMessage,
  getAdminClient,
  getEnv,
  readRawBody,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "./_utils";

type ContactPayload = {
  company?: string;
  email?: string;
  message?: string;
  name?: string;
  queryType?: string;
  sourcePath?: string;
  subject?: string;
};

const allowedQueryTypes = new Set([
  "Map Stories",
  "Local Guides",
  "Pricing or billing",
  "Partnerships",
  "Technical support",
  "Other",
]);

const defaultContactEmail = "contact@localmapr.com";

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string) {
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
}: {
  email: string;
  message: string;
  name: string;
  queryType: string;
  sourcePath: string | null;
  subject: string;
}) {
  const apiKey = getEnv("RESEND_API_KEY");
  const fromEmail = getEnv("CONTACT_FROM_EMAIL");
  const toEmail = getEnv("CONTACT_TO_EMAIL") || defaultContactEmail;

  if (!apiKey || !fromEmail) {
    return {
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
      const payload = (await response.json()) as { message?: string; error?: string };
      detail = payload.message || payload.error || "";
    } catch {
      detail = await response.text();
    }

    return {
      error: detail || `Resend returned status ${response.status}.`,
    };
  }

  return { error: null };
}

export default async function handleContact(
  request: ApiRequest,
  response: ApiResponse,
) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  let payload: ContactPayload = {};

  try {
    const body = await readRawBody(request);
    payload = JSON.parse(String(body || "{}")) as ContactPayload;
  } catch {
    sendJson(response, 400, { error: "Invalid request body." });
    return;
  }

  if (cleanText(payload.company, 200)) {
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
    sendJson(response, 400, { error: "Please enter a message with a little more detail." });
    return;
  }

  const { supabase, error: supabaseError } = getAdminClient();

  if (supabaseError || !supabase) {
    sendJson(response, 500, { error: supabaseError || "Contact storage is not configured." });
    return;
  }

  try {
    const { error } = await supabase.from("contact_queries").insert({
      email,
      message,
      name,
      query_type: queryType,
      source_path: sourcePath,
      subject,
      user_agent: userAgent,
    });

    if (error) {
      sendJson(response, 500, {
        error: error.message || "Could not save your query.",
      });
      return;
    }
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
      sendJson(response, 500, { error: emailResult.error });
      return;
    }
  } catch (error) {
    sendJson(response, 500, {
      error: errorMessage(error, "Could not send your query email."),
    });
    return;
  }

  sendJson(response, 200, {
    message: "Thanks, your query has been sent.",
  });
}
