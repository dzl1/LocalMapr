import { FormEvent, useEffect, useState } from "react";
import { SiteHeader } from "@/app/components/SiteHeader";
import { readApiResponse } from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import styles from "@/app/contact/contact.module.css";

type ContactResponse = {
  error?: string;
  message?: string;
};

const queryTypes = [
  "Map Stories",
  "Local Guides",
  "Pricing or billing",
  "Partnerships",
  "Technical support",
  "Other",
];

export function ContactPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  const workspaceHref = user ? "/dashboard" : "/login?next=/contact";

  useEffect(() => {
    document.title = "Contact | LocalMapr";
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      contactFaxNumber: String(formData.get("contactFaxNumber") ?? ""),
      email: String(formData.get("email") ?? ""),
      message: String(formData.get("message") ?? ""),
      name: String(formData.get("name") ?? ""),
      queryType: String(formData.get("queryType") ?? ""),
      sourcePath: window.location.pathname,
      subject: String(formData.get("subject") ?? ""),
    };

    setStatus("submitting");
    setFeedback("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await readApiResponse<ContactResponse>(
        response,
        "Could not send your query.",
      );

      if (!response.ok) {
        throw new Error(result.error || "Could not send your query.");
      }

      form.reset();
      setStatus("success");
      setFeedback(result.message || "Thanks, your query has been sent.");
    } catch (error) {
      setStatus("error");
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not send your query. Please try again.",
      );
    }
  }

  return (
    <main className={styles.page}>
      <SiteHeader
        className={styles.contactHeader}
        user={user}
        accountHref={workspaceHref}
      />

      <section className={styles.hero}>
        <div>
          <p>Contact</p>
          <h1>Tell us what you need help with.</h1>
          <span>
            Send a product question, support request, billing query, or idea for
            a map-based project. We will route it to the right place.
          </span>
        </div>
      </section>

      <section className={styles.contactGrid} aria-label="Contact LocalMapr">
        <form className={styles.formPanel} onSubmit={handleSubmit}>
          <div className={styles.fieldGrid}>
            <label>
              <span>Name</span>
              <input name="name" type="text" autoComplete="name" required maxLength={120} />
            </label>

            <label>
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" required maxLength={160} />
            </label>
          </div>

          <label>
            <span>Query type</span>
            <select name="queryType" required defaultValue="">
              <option value="" disabled>
                Select a query type
              </option>
              {queryTypes.map((queryType) => (
                <option value={queryType} key={queryType}>
                  {queryType}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Subject</span>
            <input name="subject" type="text" required maxLength={140} />
          </label>

          <label>
            <span>Message</span>
            <textarea name="message" required rows={8} maxLength={4000} />
          </label>

          <label className={styles.honeypot} aria-hidden="true">
            <span>Leave this field blank</span>
            <input
              name="contactFaxNumber"
              type="text"
              tabIndex={-1}
              autoComplete="new-password"
            />
          </label>

          {feedback ? (
            <p
              className={status === "success" ? styles.success : styles.error}
              role={status === "success" ? "status" : "alert"}
            >
              {feedback}
            </p>
          ) : null}

          <button type="submit" disabled={status === "submitting"}>
            {status === "submitting" ? "Sending..." : "Send query"}
          </button>
        </form>

        <aside className={styles.infoPanel}>
          <p>Direct Email</p>
          <a href="mailto:contact@localmapr.com">contact@localmapr.com</a>
          <span>
            Use the form for product and support queries so we receive the
            context we need. Email is best for attachments or longer notes.
          </span>
        </aside>
      </section>
    </main>
  );
}
