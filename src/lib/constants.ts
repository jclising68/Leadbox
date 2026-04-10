export const DEFAULT_LABELS = [
  { name: "Interested", color: "#22C55E", isSystem: true, sortOrder: 0 },
  { name: "Not Interested", color: "#EF4444", isSystem: true, sortOrder: 1 },
  { name: "Meeting Booked", color: "#3B82F6", isSystem: true, sortOrder: 2 },
  { name: "Qualifying", color: "#A855F7", isSystem: true, sortOrder: 3 },
  { name: "Wrong Person", color: "#F97316", isSystem: true, sortOrder: 4 },
  { name: "Out of Office", color: "#6B7280", isSystem: true, sortOrder: 5 },
  { name: "Maybe Future", color: "#EAB308", isSystem: true, sortOrder: 6 },
  { name: "Auto Reply", color: "#EC4899", isSystem: true, sortOrder: 7 },
  { name: "Neutral", color: "#8B5CF6", isSystem: true, sortOrder: 8 },
] as const;

export const CLASSIFICATION_PROMPT = `You are a sales email/message classifier. Classify the prospect's reply into exactly one category.

Categories:
- INTERESTED: Prospect shows interest, asks for more info, wants to learn more, positive response
- NOT_INTERESTED: Explicit rejection, unsubscribe request, not relevant, negative response
- MEETING_BOOKED: Prospect agrees to a meeting, suggests times, confirms call
- QUALIFYING: Asks qualifying questions, wants specifics (pricing, features, timeline)
- WRONG_PERSON: Says they're not the right contact, suggests someone else, wrong company
- OUT_OF_OFFICE: Auto-reply, vacation, OOO message, leave notification
- MAYBE_FUTURE: Not now but maybe later, timing isn't right, follow up later
- AUTO_REPLY: Automated response (not OOO), delivery confirmation, bounced email
- NEUTRAL: Acknowledgment without clear intent, thanks without commitment

Respond ONLY with valid JSON: {"label": "CATEGORY", "confidence": 0.0-1.0}`;
