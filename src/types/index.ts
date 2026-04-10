import type { Thread, Prospect, Message, Label, ThreadLabel, Integration } from "@prisma/client";

export type ThreadWithRelations = Thread & {
  prospect: Prospect;
  threadLabels: (ThreadLabel & { label: Label })[];
  messages?: Message[];
  _count?: { messages: number };
};

export type MessageWithRelations = Message & {
  integration?: Integration | null;
};

export type LabelWithCount = Label & {
  _count: { threadLabels: number };
};

export type InboxFilter = {
  status?: string;
  labelId?: string;
  channel?: string;
  campaignId?: string;
  search?: string;
  isUnread?: boolean;
  dateFrom?: string;
  dateTo?: string;
};

export type NormalizedWebhookPayload = {
  provider: "INSTANTLY" | "HEYREACH";
  eventType: string;
  direction: "INBOUND" | "OUTBOUND";
  channel: "EMAIL" | "LINKEDIN";
  // Prospect identifiers
  prospectEmail?: string;
  prospectLinkedinUrl?: string;
  prospectFirstName?: string;
  prospectLastName?: string;
  prospectCompany?: string;
  // Message content
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  messageText?: string;
  fromEmail?: string;
  toEmail?: string;
  // Metadata
  externalId?: string;
  campaignId?: string;
  campaignName?: string;
  sentAt?: Date;
  // Label from source
  sourceLabel?: string;
  // Raw
  rawPayload: Record<string, unknown>;
};
