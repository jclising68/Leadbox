// Apollo API client — third-party lead enrichment fallback.
// Docs: https://docs.apollo.io/reference/people-enrichment
// One call to /people/match returns the full person record (phone_numbers,
// title, organization, seniority, departments, email_status). Used as the
// waterfall fallback when Blitz returns found:false for a field.

const APOLLO_API_BASE = process.env.APOLLO_API_BASE || "https://api.apollo.io/api/v1";

const MIN_REQUEST_GAP_MS = 100;
const lastRequestByKey = new Map<string, number>();

async function pacePerKey(apiKey: string) {
  const last = lastRequestByKey.get(apiKey) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestByKey.set(apiKey, Date.now());
}

export type ApolloPhoneNumber = {
  raw_number?: string;
  sanitized_number?: string;
  type?: string; // "mobile" | "office" | "home" | ...
  position?: number;
  status?: string;
};

export type ApolloPersonMatch = {
  person?: {
    id?: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    linkedin_url?: string;
    title?: string;
    headline?: string;
    seniority?: string;
    departments?: string[];
    email?: string;
    email_status?: string; // "verified" | "unverified" | "likely_to_engage" | "guessed" | ...
    phone_numbers?: ApolloPhoneNumber[];
    organization?: {
      name?: string;
      website_url?: string;
      primary_domain?: string;
      industry?: string;
      estimated_num_employees?: number;
      annual_revenue?: number;
      linkedin_url?: string;
    };
  };
};

export type ApolloMatchInput = {
  email?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  domain?: string;
};

// Match a single person. Apollo accepts email, linkedin_url, or
// first/last + domain. We never use the fuzzy name+domain path for
// reporting integrity — the orchestrator only passes email or linkedinUrl.
export async function apolloPeopleMatch(
  apiKey: string,
  input: ApolloMatchInput,
): Promise<ApolloPersonMatch> {
  await pacePerKey(apiKey);

  const body: Record<string, unknown> = {};
  if (input.email) body.email = input.email;
  if (input.linkedinUrl) body.linkedin_url = input.linkedinUrl;
  if (input.firstName) body.first_name = input.firstName;
  if (input.lastName) body.last_name = input.lastName;
  if (input.domain) body.domain = input.domain;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${APOLLO_API_BASE}/people/match`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
      console.log(`[apollo] 429, backing off ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      lastRequestByKey.set(apiKey, Date.now());
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Apollo API ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json() as Promise<ApolloPersonMatch>;
  }
  throw new Error("Apollo API rate limit after retries");
}

// Pick the best phone from Apollo's phone_numbers array. Mobile preferred
// over office/home; first entry as final fallback.
export function pickApolloPhone(phones?: ApolloPhoneNumber[]): string | undefined {
  if (!phones || phones.length === 0) return undefined;
  const mobile = phones.find((p) => p.type === "mobile" && p.sanitized_number);
  if (mobile?.sanitized_number) return mobile.sanitized_number;
  const any = phones.find((p) => p.sanitized_number);
  return any?.sanitized_number || phones[0].raw_number;
}
