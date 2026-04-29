// Blitz API client — third-party lead enrichment.
// Docs: https://docs.blitz-api.ai
// All endpoints are POST under https://api.blitz-api.ai with x-api-key header.
// Each endpoint costs ~1 credit; most enrichment paths require a LinkedIn URL,
// so chained calls (email-to-person → phone) are the norm. The orchestrator in
// services/enrichment.ts decides when to chain — this module is a thin wrapper.

const BLITZ_API_BASE = process.env.BLITZ_API_BASE || "https://api.blitz-api.ai";

// Per-key request pacing. 100ms gap mirrors the lead-enrichment.ts (Instantly)
// pattern and is conservative until we observe Blitz's actual rate limits.
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

async function blitzCall<T>(apiKey: string, endpoint: string, body: Record<string, unknown>): Promise<T> {
  await pacePerKey(apiKey);

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BLITZ_API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
      console.log(`[blitz] 429, backing off ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      lastRequestByKey.set(apiKey, Date.now());
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Blitz API ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json() as Promise<T>;
  }
  throw new Error("Blitz API rate limit after retries");
}

// ─── Response shapes ─────────────────────────────────

export type BlitzEmailToPersonResponse = {
  found: boolean;
  person?: {
    full_name?: string;
    linkedin_url?: string;
    headline?: string;
  };
};

export type BlitzEmailResponse = {
  found: boolean;
  email?: string;
};

export type BlitzPhoneResponse = {
  found: boolean;
  phone?: string;
};

export type BlitzDomainToLinkedinResponse = {
  found: boolean;
  company_linkedin_url?: string;
};

export type BlitzCompanyResponse = {
  found: boolean;
  company?: {
    name?: string;
    industry?: string;
    employee_count?: number;
  };
};

// ─── Endpoint wrappers ───────────────────────────────

export const blitz = {
  // email → person identity (linkedin_url, full_name, headline)
  emailToPerson: (apiKey: string, email: string) =>
    blitzCall<BlitzEmailToPersonResponse>(apiKey, "/v2/enrichment/email-to-person", { email }),

  // person LinkedIn URL → verified work email
  email: (apiKey: string, personLinkedinUrl: string) =>
    blitzCall<BlitzEmailResponse>(apiKey, "/v2/enrichment/email", { person_linkedin_url: personLinkedinUrl }),

  // person LinkedIn URL → mobile phone (US only)
  phone: (apiKey: string, personLinkedinUrl: string) =>
    blitzCall<BlitzPhoneResponse>(apiKey, "/v2/enrichment/phone", { person_linkedin_url: personLinkedinUrl }),

  // domain → company LinkedIn URL
  domainToLinkedin: (apiKey: string, domain: string) =>
    blitzCall<BlitzDomainToLinkedinResponse>(apiKey, "/v2/enrichment/domain-to-linkedin", { domain }),

  // company LinkedIn URL → company info
  company: (apiKey: string, companyLinkedinUrl: string) =>
    blitzCall<BlitzCompanyResponse>(apiKey, "/v2/enrichment/company", { company_linkedin_url: companyLinkedinUrl }),
};
