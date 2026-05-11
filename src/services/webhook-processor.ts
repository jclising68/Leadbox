import type { NormalizedWebhookPayload } from "@/types";

// Maps Instantly event types to normalized format
export function normalizeInstantlyWebhook(
  payload: Record<string, unknown>
): NormalizedWebhookPayload {
  const eventType = payload.event_type as string;

  const isOutbound = [
    "email_sent",
    "campaign_completed_for_lead_without_reply",
  ].includes(eventType);

  const sourceLabel = mapInstantlyEventToLabel(eventType);

  return {
    provider: "INSTANTLY",
    eventType,
    direction: isOutbound ? "OUTBOUND" : "INBOUND",
    channel: "EMAIL",
    prospectEmail: (payload.lead_email as string) || (payload.email as string),
    prospectFirstName: payload.first_name as string | undefined,
    prospectLastName: payload.last_name as string | undefined,
    prospectCompany: payload.company_name as string | undefined,
    subject:
      (payload.reply_subject as string) || (payload.subject as string),
    bodyText:
      (payload.reply_text as string) ||
      (payload.reply_text_snippet as string) ||
      (payload.text as string),
    bodyHtml: (payload.reply_html as string) || (payload.html as string),
    fromEmail: payload.from_email as string | undefined,
    toEmail:
      (payload.to_email as string) || (payload.lead_email as string),
    externalId: (payload.email_id as string) || (payload.id as string),
    campaignId: payload.campaign_id as string | undefined,
    campaignName: payload.campaign_name as string | undefined,
    sentAt: payload.timestamp
      ? new Date(payload.timestamp as string)
      : undefined,
    sourceLabel,
    rawPayload: payload,
  };
}

// Maps HeyReach event types to normalized format
export function normalizeHeyreachWebhook(
  payload: Record<string, unknown>
): NormalizedWebhookPayload {
  const eventType = payload.event_type as string || payload.eventType as string;
  const lead = (payload.lead as Record<string, unknown>) || payload;

  const isOutbound = [
    "MESSAGE_SENT",
    "CONNECTION_REQUEST_SENT",
    "INMAIL_SENT",
  ].includes(eventType);

  const sourceLabel = mapHeyreachEventToLabel(eventType);

  return {
    provider: "HEYREACH",
    eventType,
    direction: isOutbound ? "OUTBOUND" : "INBOUND",
    channel: "LINKEDIN",
    prospectEmail: lead.email as string | undefined,
    prospectLinkedinUrl:
      (lead.linkedinUrl as string) ||
      (lead.linkedin_url as string) ||
      (lead.profileUrl as string),
    prospectFirstName:
      (lead.firstName as string) || (lead.first_name as string),
    prospectLastName:
      (lead.lastName as string) || (lead.last_name as string),
    prospectCompany:
      (lead.companyName as string) || (lead.company as string),
    messageText:
      (payload.message as string) ||
      (payload.messageText as string) ||
      (payload.reply_text as string),
    externalId:
      (payload.messageId as string) ||
      (payload.message_id as string) ||
      (payload.id as string),
    campaignId:
      (payload.campaignId as string) ||
      (payload.campaign_id as string),
    campaignName: payload.campaignName as string | undefined,
    sentAt: payload.timestamp
      ? new Date(payload.timestamp as string)
      : undefined,
    sourceLabel,
    rawPayload: payload,
  };
}

function mapInstantlyEventToLabel(eventType: string): string | undefined {
  const map: Record<string, string> = {
    reply_received: "", // Let AI classify
    auto_reply_received: "Auto Reply",
    lead_interested: "Interested",
    lead_not_interested: "Not Interested",
    lead_meeting_booked: "Meeting Booked",
    lead_meeting_completed: "Meeting Booked",
    lead_wrong_person: "Wrong Person",
    lead_out_of_office: "Out of Office",
    lead_neutral: "Neutral",
    lead_closed: "Not Interested",
  };
  return map[eventType] || undefined;
}

// Maps Lemlist activity types to normalized format
export function normalizeLemlistWebhook(
  payload: Record<string, unknown>
): NormalizedWebhookPayload {
  const type = (payload.type as string) || "";
  const isOutbound = type === "emailsSent";

  return {
    provider: "LEMLIST",
    eventType: type,
    direction: isOutbound ? "OUTBOUND" : "INBOUND",
    channel: "EMAIL",
    prospectEmail: (payload.leadEmail as string) || (payload.email as string),
    prospectFirstName: payload.leadFirstName as string | undefined,
    prospectLastName: payload.leadLastName as string | undefined,
    prospectCompany: payload.leadCompanyName as string | undefined,
    subject: payload.subject as string | undefined,
    // bodyText/bodyHtml will be overwritten by webhook handler after MCP fetch
    bodyText: payload.messagePreview as string | undefined,
    bodyHtml: undefined,
    fromEmail: isOutbound
      ? ((payload.sendUserEmail as string) || (payload.sendUserMailboxProviderId as string))
      : (payload.fromEmail as string) || (payload.leadEmail as string),
    toEmail: isOutbound
      ? ((payload.leadEmail as string) || (payload.email as string))
      : ((payload.sendUserEmail as string) || (payload.sendUserMailboxProviderId as string)),
    externalId: payload._id as string | undefined,
    campaignId: payload.campaignId as string | undefined,
    campaignName: (payload.campaignName as string) || (payload.name as string),
    sentAt: payload.createdAt ? new Date(payload.createdAt as string) : undefined,
    rawPayload: payload,
  };
}

function mapHeyreachEventToLabel(eventType: string): string | undefined {
  const map: Record<string, string> = {
    MESSAGE_REPLY_RECEIVED: "", // Let AI classify
    EVERY_MESSAGE_REPLY_RECEIVED: "",
    INMAIL_REPLY_RECEIVED: "",
    CONNECTION_REQUEST_ACCEPTED: "",
    LEAD_FINISHED_SEQUENCE_WITHOUT_REPLYING: "Not Interested",
  };
  return map[eventType] || undefined;
}
