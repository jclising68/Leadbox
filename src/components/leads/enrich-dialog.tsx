"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useParams, useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Info } from "lucide-react";
import { toast } from "sonner";

// Fields the user can request the orchestrator to enrich. Mirrors EnrichField
// in services/enrichment.ts — keep in sync.
type EnrichField = "phone" | "title" | "linkedinUrl" | "verifiedEmail" | "company";

type EnrichmentSourceMap = Partial<
  Record<EnrichField, "BLITZ" | "APOLLO" | "NOT_FOUND">
>;

// Subset of Prospect needed to compute missing-field math.
export type EnrichDialogProspect = {
  id: string;
  email?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  title?: string | null;
  company?: string | null;
  domain?: string | null;
  enrichmentSource?: EnrichmentSourceMap | null;
};

const FIELD_DEFS: { key: EnrichField; label: string; hint?: string; getColumn: (p: EnrichDialogProspect) => string | null | undefined }[] = [
  { key: "phone", label: "Phone", hint: "US: Blitz · Global: Apollo fallback", getColumn: (p) => p.phone },
  { key: "title", label: "Job title", getColumn: (p) => p.title },
  { key: "linkedinUrl", label: "LinkedIn URL", getColumn: (p) => p.linkedinUrl },
  { key: "verifiedEmail", label: "Verified email", hint: "Useful when only LinkedIn is known", getColumn: (p) => p.email },
  { key: "company", label: "Company info", getColumn: (p) => p.company },
];

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

// "Field is fetchable for this prospect" = column is empty AND not marked
// NOT_FOUND in enrichmentSource (unless retryNotFound is enabled).
function fieldIsFetchable(p: EnrichDialogProspect, f: EnrichField, retryNotFound: boolean): boolean {
  const fieldDef = FIELD_DEFS.find((x) => x.key === f)!;
  if (!isEmpty(fieldDef.getColumn(p))) return false;
  const src = p.enrichmentSource ?? {};
  if (!retryNotFound && src[f] === "NOT_FOUND") return false;
  return true;
}

// Estimate Blitz + Apollo call counts. Worst-case bounds — actual runs lower
// when Blitz finds the field on the first try. Each prospect:
//   - Blitz needs email-to-person if any of {phone, title, linkedinUrl, verifiedEmail}
//     is requested and prospect has no linkedinUrl yet → +1
//   - Each {phone, verifiedEmail} requested (with linkedin available) → +1 each
//   - Title from email-to-person comes free (counted in step 1) — no extra call
//   - Company requested and prospect has email/domain → +2 (domain-to-linkedin + company)
//   - Apollo fires at most once per prospect, only if any field is still missing
//     after Blitz. We can't predict that, so the worst-case Apollo bound is
//     "1 per prospect that has any fetchable field".
function estimateCalls(
  prospects: EnrichDialogProspect[],
  fields: EnrichField[],
  retryNotFound: boolean,
  hasBlitz: boolean,
  hasApollo: boolean,
): { blitz: number; apollo: number; skipped: number } {
  let blitz = 0;
  let apollo = 0;
  let skipped = 0;

  for (const p of prospects) {
    const fetchable = fields.filter((f) => fieldIsFetchable(p, f, retryNotFound));
    if (fetchable.length === 0) {
      skipped++;
      continue;
    }
    // Skip if no match key (no email and no linkedin) — orchestrator marks this
    // as an error and makes zero API calls.
    if (isEmpty(p.email) && isEmpty(p.linkedinUrl)) {
      skipped++;
      continue;
    }

    if (hasBlitz) {
      const linkedinFields = fetchable.filter(
        (f) => f === "phone" || f === "title" || f === "linkedinUrl" || f === "verifiedEmail",
      );
      if (linkedinFields.length > 0 && isEmpty(p.linkedinUrl) && !isEmpty(p.email)) {
        blitz += 1; // email-to-person
      }
      if (fetchable.includes("phone")) blitz += 1;
      if (fetchable.includes("verifiedEmail")) blitz += 1;
      // title comes free from email-to-person (no extra call)
      // linkedinUrl also from email-to-person (no extra call)
      if (fetchable.includes("company")) {
        if (!isEmpty(p.domain) || !isEmpty(p.email)) {
          blitz += 2; // domain-to-linkedin + company
        }
      }
    }

    if (hasApollo) {
      apollo += 1; // worst-case fallback
    }
  }

  return { blitz, apollo, skipped };
}

type EnrichDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: EnrichDialogProspect[];
  hasBlitz: boolean;
  hasApollo: boolean;
  onCleared?: () => void; // optional callback after successful submit
};

export function EnrichDialog({ open, onOpenChange, selected, hasBlitz, hasApollo, onCleared }: EnrichDialogProps) {
  const workspaceId = useCurrentWorkspaceId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string | undefined;
  const [picks, setPicks] = useState<Record<EnrichField, boolean>>({
    phone: false,
    title: false,
    linkedinUrl: false,
    verifiedEmail: false,
    company: false,
  });
  const [retryNotFound, setRetryNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [useBlitz, setUseBlitz] = useState(true);
  const [useApollo, setUseApollo] = useState(true);

  // Reset picks when dialog reopens with a different selection.
  useEffect(() => {
    if (open) {
      setPicks({ phone: false, title: false, linkedinUrl: false, verifiedEmail: false, company: false });
      setRetryNotFound(false);
      // Default each toggle ON if that provider is connected, OFF otherwise.
      setUseBlitz(hasBlitz);
      setUseApollo(hasApollo);
    }
  }, [open, hasBlitz, hasApollo]);

  // For each field, count how many of the selected rows are missing it.
  // Used to disable checkboxes when no row needs that field.
  const fetchableCounts = useMemo(() => {
    const counts: Record<EnrichField, number> = {
      phone: 0, title: 0, linkedinUrl: 0, verifiedEmail: 0, company: 0,
    };
    for (const p of selected) {
      for (const f of FIELD_DEFS) {
        if (fieldIsFetchable(p, f.key, retryNotFound)) counts[f.key]++;
      }
    }
    return counts;
  }, [selected, retryNotFound]);

  const requestedFields = useMemo(
    () => (Object.keys(picks) as EnrichField[]).filter((f) => picks[f]),
    [picks],
  );

  // Estimate uses the *active* providers (toggles ANDed with what's connected).
  const estimate = useMemo(
    () => estimateCalls(selected, requestedFields, retryNotFound, hasBlitz && useBlitz, hasApollo && useApollo),
    [selected, requestedFields, retryNotFound, hasBlitz, hasApollo, useBlitz, useApollo],
  );

  const atLeastOneProviderActive = (hasBlitz && useBlitz) || (hasApollo && useApollo);
  const canSubmit = requestedFields.length > 0 && selected.length > 0 && atLeastOneProviderActive;

  async function submit() {
    if (!canSubmit || !workspaceId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/leads/enrich", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          prospectIds: selected.map((p) => p.id),
          fields: requestedFields,
          retryNotFound,
          useBlitz: hasBlitz && useBlitz,
          useApollo: hasApollo && useApollo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start enrichment");

      if (data.status === "already_running") {
        toast.info(data.message || "An enrichment job is already running.");
      } else {
        toast.success(`Enrichment started for ${selected.length} lead${selected.length === 1 ? "" : "s"}.`);
      }
      onOpenChange(false);
      onCleared?.();

      // Poll workspace enrich-status; refetch prospects when it flips to false.
      pollUntilDone(workspaceId, queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start enrichment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Enrich {selected.length} lead{selected.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            Pick the missing fields and the providers to use for this run.
          </DialogDescription>
        </DialogHeader>

        {!hasBlitz && !hasApollo ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-700 dark:text-amber-400">
              <div className="font-medium mb-1">No enrichment provider configured</div>
              <div className="text-xs">
                Add a <span className="font-medium">Blitz</span> or <span className="font-medium">Apollo</span> API key
                in Settings → Integrations to enable lead enrichment for this workspace.
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                if (slug) router.push(`/ws/${slug}/settings/integrations`);
              }}
            >
              Go to Settings → Integrations
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {FIELD_DEFS.map((f) => {
                const count = fetchableCounts[f.key];
                const disabled = count === 0;
                return (
                  <label
                    key={f.key}
                    className={`flex items-start gap-3 rounded-md border border-border px-3 py-2 cursor-pointer transition-colors ${
                      disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-accent/40"
                    }`}
                  >
                    <Checkbox
                      checked={picks[f.key]}
                      onCheckedChange={(v) => !disabled && setPicks((p) => ({ ...p, [f.key]: !!v }))}
                      disabled={disabled}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{f.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {disabled
                          ? "All selected leads already have this"
                          : `${count} of ${selected.length} lead${selected.length === 1 ? "" : "s"} missing`}
                        {f.hint && !disabled ? ` · ${f.hint}` : ""}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="rounded-md border border-border">
              <div className="px-3 py-2 border-b border-border">
                <div className="text-sm font-medium">Providers</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Smart waterfall: Blitz first, Apollo fills the gaps. Toggle either off for this run to control cost.
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    Blitz
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Primary</span>
                    {!hasBlitz && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">Not connected</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Verified emails + US mobile phones. Flat-fee subscription.
                  </div>
                </div>
                <Switch
                  checked={hasBlitz && useBlitz}
                  onCheckedChange={setUseBlitz}
                  disabled={!hasBlitz}
                />
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    Apollo
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Fallback</span>
                    {!hasApollo && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">Not connected</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Global phones + richer firmographics. Per-credit cost.
                  </div>
                </div>
                <Switch
                  checked={hasApollo && useApollo}
                  onCheckedChange={setUseApollo}
                  disabled={!hasApollo}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Retry previously not-found fields</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Off by default — saves cost. Enable if provider data may have improved since last try.
                </div>
              </div>
              <Switch checked={retryNotFound} onCheckedChange={setRetryNotFound} />
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Info className="h-3 w-3" /> Estimated calls
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">Blitz</span>
                <span>up to {estimate.blitz}</span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">Apollo</span>
                <span>up to {estimate.apollo}</span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">Skipped (already complete or not-found)</span>
                <span>{estimate.skipped}</span>
              </div>
              <div className="text-[10px] text-muted-foreground pt-1">
                {hasBlitz && useBlitz && hasApollo && useApollo
                  ? "Apollo only fires for fields Blitz couldn't find. Actual usage will be lower."
                  : hasBlitz && useBlitz
                    ? "Blitz only — Apollo disabled for this run."
                    : "Apollo only — Blitz disabled for this run."}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={submit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Start enrichment
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Poll workspace enrich-status every 5s. When the flag flips to false, invalidate
// prospect queries so the table refreshes with the new data. Bounded retries so
// a stuck flag doesn't poll forever.
async function pollUntilDone(workspaceId: string, queryClient: ReturnType<typeof useQueryClient>) {
  for (let i = 0; i < 120; i++) {
    // up to 10 minutes (120 * 5s)
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/enrich-status`, {
        headers: { "x-workspace-id": workspaceId },
        cache: "no-store",
      });
      if (!res.ok) break;
      const data = await res.json();
      if (!data.running) {
        await queryClient.invalidateQueries({ queryKey: ["prospects"] });
        toast.success("Enrichment finished. Lead data refreshed.");
        return;
      }
    } catch {
      // Network blip — keep polling.
    }
  }
  // Timed out — refetch anyway so partial progress is visible.
  await queryClient.invalidateQueries({ queryKey: ["prospects"] });
}
