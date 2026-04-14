/**
 * Minimal transactional email helper. Uses Resend via plain fetch so we
 * don't pull in an extra SDK. If `RESEND_API_KEY` isn't set, the email
 * isn't sent — we log the payload instead so an admin can retrieve it
 * from Vercel runtime logs if needed. Never throws; a send failure must
 * not block password-reset creation on our side.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "LeadBox <onboarding@resend.dev>";

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[send-email] RESEND_API_KEY not set — would have emailed ${to}. Subject: ${subject}`
      );
      console.warn(`[send-email] Body preview:\n${text || html}`);
    } else {
      console.warn(
        `[send-email] RESEND_API_KEY not set — email to ${to} not sent. Subject: ${subject}`
      );
    }
    return { sent: false, error: "email service not configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[send-email] Resend ${res.status}: ${body}`);
      return { sent: false, error: `Resend ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[send-email] network error: ${msg}`);
    return { sent: false, error: msg };
  }
}
