// Lead enrichment orchestrator — Blitz primary → Apollo waterfall fallback.
//
// Cost model: Blitz is a flat-fee subscription (effectively free after sunk
// cost). Apollo is per-credit. So we always try Blitz first and only spend
// Apollo credits for fields Blitz couldn't find. Once both providers fail
// for a field on a given prospect, we mark it NOT_FOUND in
// Prospect.enrichmentSource and never call again unless the user explicitly
// opts in via retryNotFound.

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { blitz } from "@/lib/blitz";
import { apolloPeopleMatch, pickApolloPhone, type ApolloPersonMatch } from "@/lib/apollo";
import type { Prisma } from "@prisma/client";

export type EnrichField =
  | "phone"
  | "title"
  | "linkedinUrl"
  | "verifiedEmail" // writes to Prospect.email when missing
  | "company";      // writes company + industry/employeeCount metadata

export type EnrichmentSourceMap = Partial<
  Record<EnrichField | "industry" | "employeeCount", "BLITZ" | "APOLLO" | "NOT_FOUND">
>;

export type EnrichOpts = {
  retryNotFound?: boolean;
  /** Total ms allowed for the run. Default 240s (under Vercel's 300s). */
  timeBudgetMs?: number;
  /** Per-run provider toggles. Defaults true. Lets the user opt out of one
   * provider for a single run (cost control). */
  useBlitz?: boolean;
  useApollo?: boolean;
};

export type EnrichResult = {
  enriched: number;        // prospects that had at least one field updated
  failed: number;          // prospects that errored out
  blitzCalls: number;
  apolloCalls: number;
  skipped: number;         // prospects with no match key or all fields already complete
};

const ALL_FIELDS: EnrichField[] = ["phone", "title", "linkedinUrl", "verifiedEmail", "company"];

// Test if a Prospect column has a meaningful value. Empty string and null
// both count as missing.
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

// Compute which requested fields are actually missing on this prospect,
// considering both current column state and prior enrichment metadata.
function fieldsToFetch(
  prospect: {
    phone: string | null;
    title: string | null;
    linkedinUrl: string | null;
    email: string | null;
    company: string | null;
    enrichedFields: string[];
    enrichmentSource: Prisma.JsonValue | null;
  },
  requested: EnrichField[],
  retryNotFound: boolean,
): EnrichField[] {
  const sourceMap = (prospect.enrichmentSource ?? {}) as EnrichmentSourceMap;
  return requested.filter((f) => {
    // Check current column value
    const colName: keyof typeof prospect =
      f === "verifiedEmail" ? "email" : f === "company" ? "company" : f;
    if (!isEmpty(prospect[colName])) return false;
    // Skip fields previously marked NOT_FOUND unless user opted in
    if (!retryNotFound && sourceMap[f] === "NOT_FOUND") return false;
    return true;
  });
}

type ProspectRow = {
  id: string;
  email: string | null;
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  enrichedFields: string[];
  enrichmentSource: Prisma.JsonValue | null;
};

// Run the per-prospect waterfall. Returns the update payload + tallies.
async function enrichOneProspect(
  p: ProspectRow,
  fields: EnrichField[],
  blitzKey: string | null,
  apolloKey: string | null,
  retryNotFound: boolean,
): Promise<{
  updateData: Prisma.ProspectUpdateInput;
  blitzCalls: number;
  apolloCalls: number;
  changed: boolean;
}> {
  const tally = { blitzCalls: 0, apolloCalls: 0 };
  const todo = fieldsToFetch(p, fields, retryNotFound);
  if (todo.length === 0) {
    return { updateData: {}, ...tally, changed: false };
  }

  // Match basis check — need at least email or linkedinUrl. We never use
  // name+domain fuzzy match in v1 because it can return wrong matches.
  if (isEmpty(p.email) && isEmpty(p.linkedinUrl)) {
    return {
      updateData: { enrichmentError: "no match key (email or LinkedIn URL required)" },
      ...tally,
      changed: false,
    };
  }

  // Track which fields we've filled this run, by source.
  const filled: Partial<Record<EnrichField, "BLITZ" | "APOLLO">> = {};
  const updateData: Prisma.ProspectUpdateInput = {};
  // Mutable working copy for chained-call inputs
  let workingLinkedin = p.linkedinUrl;
  let workingCompanyLinkedin: string | null = null;

  // ─── Blitz pass ──────────────────────────────────────────
  if (blitzKey) {
    const needsLinkedinFor = todo.filter((f) =>
      f === "phone" || f === "title" || f === "linkedinUrl" || f === "verifiedEmail"
    );

    // Step 1: ensure we have a LinkedIn URL if any field needs it.
    // email-to-person also gives us the headline (→ title) and full_name
    // for free in the same call, so cache the response.
    let etpResponse: Awaited<ReturnType<typeof blitz.emailToPerson>> | null = null;
    if (needsLinkedinFor.length > 0 && isEmpty(workingLinkedin) && !isEmpty(p.email)) {
      try {
        etpResponse = await blitz.emailToPerson(blitzKey, p.email!);
        tally.blitzCalls++;
        if (etpResponse.found && etpResponse.person?.linkedin_url) {
          workingLinkedin = etpResponse.person.linkedin_url;
          if (todo.includes("linkedinUrl")) {
            updateData.linkedinUrl = etpResponse.person.linkedin_url;
            filled.linkedinUrl = "BLITZ";
          }
          // Headline ≈ title (Blitz's email-to-person returns headline, not strict title).
          if (todo.includes("title") && etpResponse.person.headline) {
            updateData.title = etpResponse.person.headline;
            filled.title = "BLITZ";
          }
          // Backfill firstName/lastName if Prospect has them empty — bonus data
          // from a call we already paid for.
          if (etpResponse.person.full_name) {
            const parts = etpResponse.person.full_name.trim().split(/\s+/);
            if (isEmpty(p.firstName) && parts[0]) updateData.firstName = parts[0];
            if (isEmpty(p.lastName) && parts.length > 1) {
              updateData.lastName = parts.slice(1).join(" ");
            }
          }
        }
      } catch (err) {
        console.warn(`[enrichment] Blitz email-to-person failed for ${p.email}:`, err instanceof Error ? err.message : err);
      }
    }

    // Step 2: phone (needs linkedin)
    if (todo.includes("phone") && !filled.phone && !isEmpty(workingLinkedin)) {
      try {
        const r = await blitz.phone(blitzKey, workingLinkedin!);
        tally.blitzCalls++;
        if (r.found && r.phone) {
          updateData.phone = r.phone;
          filled.phone = "BLITZ";
        }
      } catch (err) {
        console.warn(`[enrichment] Blitz phone failed for ${p.email}:`, err instanceof Error ? err.message : err);
      }
    }

    // Step 3: verified email (needs linkedin) — only if Prospect has no email yet.
    // Most prospects DO have email (that's how they got into LeadBox), so this
    // branch is rare. Useful for LinkedIn-imported HeyReach prospects.
    if (todo.includes("verifiedEmail") && !filled.verifiedEmail && !isEmpty(workingLinkedin)) {
      try {
        const r = await blitz.email(blitzKey, workingLinkedin!);
        tally.blitzCalls++;
        if (r.found && r.email) {
          updateData.email = r.email;
          filled.verifiedEmail = "BLITZ";
        }
      } catch (err) {
        console.warn(`[enrichment] Blitz email failed for linkedin ${workingLinkedin}:`, err instanceof Error ? err.message : err);
      }
    }

    // Step 4: company info — needs company linkedin URL, may chain via domain.
    if (todo.includes("company") && !filled.company) {
      // Try to derive company linkedin URL: from domain, or via etpResponse?
      // (etp doesn't give company linkedin directly — chain through domain.)
      const domain = p.domain || (p.email ? p.email.split("@")[1] : null);
      if (domain) {
        try {
          const dl = await blitz.domainToLinkedin(blitzKey, domain);
          tally.blitzCalls++;
          if (dl.found && dl.company_linkedin_url) {
            workingCompanyLinkedin = dl.company_linkedin_url;
            try {
              const c = await blitz.company(blitzKey, workingCompanyLinkedin);
              tally.blitzCalls++;
              if (c.found && c.company) {
                if (c.company.name) {
                  updateData.company = c.company.name;
                  filled.company = "BLITZ";
                }
                // industry/employeeCount aren't direct columns in Prospect,
                // but we surface them via enrichmentSource for future use.
                // Skipping persistence in v1 to avoid schema bloat.
              }
            } catch (err) {
              console.warn(`[enrichment] Blitz company failed:`, err instanceof Error ? err.message : err);
            }
          }
        } catch (err) {
          console.warn(`[enrichment] Blitz domain-to-linkedin failed for ${domain}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  // ─── Apollo fallback ─────────────────────────────────────
  // Fire a single /people/match if any requested field is still unfilled
  // and Apollo is configured. One Apollo call returns most fields at once.
  const stillMissing = todo.filter((f) => !filled[f]);
  if (apolloKey && stillMissing.length > 0) {
    let apolloRes: ApolloPersonMatch | null = null;
    try {
      apolloRes = await apolloPeopleMatch(apolloKey, {
        email: p.email || undefined,
        linkedinUrl: workingLinkedin || undefined,
      });
      tally.apolloCalls++;
    } catch (err) {
      console.warn(`[enrichment] Apollo match failed for ${p.email || workingLinkedin}:`, err instanceof Error ? err.message : err);
    }

    if (apolloRes?.person) {
      const ap = apolloRes.person;
      // Per-field fallback fills
      if (stillMissing.includes("phone")) {
        const phone = pickApolloPhone(ap.phone_numbers);
        if (phone) {
          updateData.phone = phone;
          filled.phone = "APOLLO";
        }
      }
      if (stillMissing.includes("title")) {
        // Apollo's `title` is a true job title (preferred over Blitz's headline)
        if (ap.title) {
          updateData.title = ap.title;
          filled.title = "APOLLO";
        } else if (ap.headline) {
          updateData.title = ap.headline;
          filled.title = "APOLLO";
        }
      }
      if (stillMissing.includes("linkedinUrl") && ap.linkedin_url) {
        updateData.linkedinUrl = ap.linkedin_url;
        filled.linkedinUrl = "APOLLO";
      }
      if (stillMissing.includes("verifiedEmail") && ap.email) {
        updateData.email = ap.email;
        filled.verifiedEmail = "APOLLO";
      }
      if (stillMissing.includes("company") && ap.organization?.name) {
        updateData.company = ap.organization.name;
        filled.company = "APOLLO";
      }
      // Capture email_status when Apollo provides it — useful for reporting
      // even when the email itself wasn't a missing field.
      if (ap.email_status) {
        updateData.emailStatus = ap.email_status;
      }
      // Backfill name when missing (free metadata from a call we already paid for)
      if (isEmpty(p.firstName) && ap.first_name) updateData.firstName = ap.first_name;
      if (isEmpty(p.lastName) && ap.last_name) updateData.lastName = ap.last_name;
    }
  }

  // ─── Build enrichmentSource map ──────────────────────────
  // Merge prior source map with this run's results. Mark fields that are
  // still missing as NOT_FOUND so future runs skip them.
  const priorSource = (p.enrichmentSource ?? {}) as EnrichmentSourceMap;
  const newSource: EnrichmentSourceMap = { ...priorSource };
  for (const f of todo) {
    if (filled[f]) {
      newSource[f] = filled[f]!;
    } else {
      // Field was requested, neither provider filled it → mark NOT_FOUND
      newSource[f] = "NOT_FOUND";
    }
  }
  updateData.enrichmentSource = newSource as unknown as Prisma.InputJsonValue;

  // enrichedFields: union of prior + fields touched this run (success or NOT_FOUND).
  // This is what the UI uses to decide whether to show a checkbox at all
  // (even NOT_FOUND counts as "we tried").
  const priorFields = new Set(p.enrichedFields ?? []);
  for (const f of todo) priorFields.add(f);
  updateData.enrichedFields = Array.from(priorFields);

  const changed = Object.keys(filled).length > 0;
  if (changed) {
    updateData.enrichedAt = new Date();
    updateData.enrichmentError = null;
  }

  return { updateData, ...tally, changed };
}

export async function enrichProspects(
  workspaceId: string,
  prospectIds: string[],
  fields: EnrichField[],
  opts: EnrichOpts = {},
): Promise<EnrichResult> {
  const { retryNotFound = false, timeBudgetMs = 240_000, useBlitz = true, useApollo = true } = opts;
  const startTime = Date.now();

  // Validate field set
  const requested = fields.filter((f) => ALL_FIELDS.includes(f));
  if (requested.length === 0) {
    return { enriched: 0, failed: 0, blitzCalls: 0, apolloCalls: 0, skipped: prospectIds.length };
  }

  // Load workspace integrations once. Either or both may be present.
  const integrations = await prisma.integration.findMany({
    where: { workspaceId, provider: { in: ["BLITZ", "APOLLO"] }, isActive: true },
  });
  const blitzIntegration = integrations.find((i) => i.provider === "BLITZ");
  const apolloIntegration = integrations.find((i) => i.provider === "APOLLO");
  // Per-run toggles can opt out of a configured provider. A toggle off means
  // we treat that provider as unavailable for this run only — the integration
  // row stays untouched.
  const blitzKey = blitzIntegration && useBlitz
    ? decrypt(blitzIntegration.apiKeyEncrypted, blitzIntegration.apiKeyIv, blitzIntegration.apiKeyTag)
    : null;
  const apolloKey = apolloIntegration && useApollo
    ? decrypt(apolloIntegration.apiKeyEncrypted, apolloIntegration.apiKeyIv, apolloIntegration.apiKeyTag)
    : null;

  if (!blitzKey && !apolloKey) {
    throw new Error("No enrichment provider available for this run (check provider toggles and workspace integrations)");
  }

  console.log(`[enrichment] Run start: workspace=${workspaceId} prospects=${prospectIds.length} fields=${requested.join(",")} blitz=${!!blitzKey} apollo=${!!apolloKey} retryNotFound=${retryNotFound}`);

  // Fetch prospects in one query
  const prospects = await prisma.prospect.findMany({
    where: { id: { in: prospectIds }, workspaceId },
    select: {
      id: true,
      email: true,
      linkedinUrl: true,
      firstName: true,
      lastName: true,
      phone: true,
      title: true,
      company: true,
      domain: true,
      enrichedFields: true,
      enrichmentSource: true,
    },
  });

  let enriched = 0;
  let failed = 0;
  let skipped = 0;
  let blitzCallsTotal = 0;
  let apolloCallsTotal = 0;

  for (const p of prospects) {
    if (Date.now() - startTime > timeBudgetMs) {
      console.log(`[enrichment] Time budget exhausted; stopping at ${enriched + failed + skipped}/${prospects.length}`);
      break;
    }

    try {
      const result = await enrichOneProspect(p, requested, blitzKey, apolloKey, retryNotFound);
      blitzCallsTotal += result.blitzCalls;
      apolloCallsTotal += result.apolloCalls;

      if (Object.keys(result.updateData).length === 0) {
        skipped++;
        continue;
      }

      await prisma.prospect.update({
        where: { id: p.id },
        data: result.updateData,
      });

      if (result.changed) {
        enriched++;
      } else {
        // updateData was non-empty (e.g. enrichmentSource markers, error message)
        // but no actual field was filled. Counts as skipped from the user's POV.
        skipped++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[enrichment] Failed for prospect ${p.id}:`, msg);
      try {
        await prisma.prospect.update({
          where: { id: p.id },
          data: { enrichmentError: msg.slice(0, 500) },
        });
      } catch {
        // Swallow secondary failure — primary error already logged.
      }
    }
  }

  console.log(`[enrichment] Run done: enriched=${enriched} failed=${failed} skipped=${skipped} blitzCalls=${blitzCallsTotal} apolloCalls=${apolloCallsTotal} elapsed=${Math.round((Date.now() - startTime) / 1000)}s`);

  return { enriched, failed, skipped, blitzCalls: blitzCallsTotal, apolloCalls: apolloCallsTotal };
}
