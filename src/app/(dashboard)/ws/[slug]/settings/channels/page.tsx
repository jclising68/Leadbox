"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Trash2, Loader2, Mail, ServerCrash } from "lucide-react";
import { cn } from "@/lib/utils";

type Channel = {
  id: string;
  email: string;
  displayName: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  createdAt: string;
};

type ParsedRow = {
  email: string;
  displayName?: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
};

type SourceFormat = "zapmail" | "mission";

// ── CSV parsers ───────────────────────────────────────────────────────────────

function parseCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(",").map((v) => v.trim()))
    .filter((row) => row.some((v) => v));
}

// Zapmail: Email, First Name, Last Name, IMAP Username, IMAP Password,
//   IMAP Host, IMAP Port, IMAP Secure, SMTP Username, SMTP Password,
//   SMTP Host, SMTP Port, SMTP Secure
function parseZapmail(text: string): ParsedRow[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const results: ParsedRow[] = [];
  for (const row of rows.slice(1)) {
    const email = row[0];
    const displayName = [row[1], row[2]].filter(Boolean).join(" ") || undefined;
    const smtpUser = row[8];
    const smtpPass = row[9];
    const smtpHost = row[10];
    const smtpPort = parseInt(row[11]) || 587;
    const smtpSecure = row[12]?.toLowerCase() === "true" || smtpPort === 465;
    if (email && smtpHost && smtpUser && smtpPass) {
      results.push({ email, displayName, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass });
    }
  }
  return results;
}

// Mission Inbox: Email Address, Full Name, IMAP Username, IMAP Password,
//   IMAP Host, IMAP Port, SMTP Username, SMTP Password, SMTP Host, SMTP Port
function parseMissionInbox(text: string): ParsedRow[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const results: ParsedRow[] = [];
  for (const row of rows.slice(1)) {
    const email = row[0];
    const displayName = row[1] || undefined;
    const smtpUser = row[6];
    const smtpPass = row[7];
    const smtpHost = row[8];
    const smtpPort = parseInt(row[9]) || 587;
    const smtpSecure = smtpPort === 465;
    if (email && smtpHost && smtpUser && smtpPass) {
      results.push({ email, displayName, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass });
    }
  }
  return results;
}

// ── Component ─────────────────────────────────────────────────────────────────

const SOURCES: { id: SourceFormat; label: string; hint: string }[] = [
  {
    id: "zapmail",
    label: "Zapmail",
    hint: "Email, First Name, Last Name, … SMTP Username, SMTP Password, SMTP Host, SMTP Port, SMTP Secure",
  },
  {
    id: "mission",
    label: "Mission Inbox",
    hint: "Email Address, Full Name, … SMTP Username, SMTP Password, SMTP Host, SMTP Port",
  },
];

export default function ChannelsPage() {
  const workspaceId = useCurrentWorkspaceId();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<SourceFormat>("zapmail");
  const [importing, setImporting] = useState(false);

  const { data, isLoading } = useQuery<{ channels: Channel[] }>({
    queryKey: ["smtp-channels", workspaceId],
    queryFn: async () => {
      const res = await fetch("/api/smtp-channels", {
        headers: { "x-workspace-id": workspaceId! },
      });
      return res.json();
    },
    enabled: !!workspaceId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/smtp-channels/${id}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspaceId! },
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smtp-channels", workspaceId] });
      toast.success("Channel removed");
    },
    onError: () => toast.error("Failed to remove channel"),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const text = await file.text();
    const rows = source === "zapmail" ? parseZapmail(text) : parseMissionInbox(text);

    if (rows.length === 0) {
      toast.error(`No valid rows found. Make sure this is a ${source === "zapmail" ? "Zapmail" : "Mission Inbox"} CSV.`);
      return;
    }

    setImporting(true);
    try {
      const res = await fetch("/api/smtp-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId! },
        body: JSON.stringify({ channels: rows }),
      });
      const json = await res.json() as { imported?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      toast.success(
        `Imported ${json.imported} mailbox${json.imported !== 1 ? "es" : ""}${json.skipped ? ` (${json.skipped} skipped)` : ""}`
      );
      qc.invalidateQueries({ queryKey: ["smtp-channels", workspaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const channels = data?.channels ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Channels</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your mailboxes via SMTP to send emails with file attachments directly from the inbox.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import mailboxes</CardTitle>
          <CardDescription>
            Select where you&apos;re exporting from, then upload the CSV. Re-importing updates existing entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Source selector */}
          <div className="grid grid-cols-2 gap-3">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSource(s.id)}
                className={cn(
                  "text-left rounded-lg border p-3 transition-colors",
                  source === s.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
                )}
              >
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.hint}</p>
              </button>
            ))}
          </div>

          {/* Upload */}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="gap-2"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? "Importing…" : `Upload ${source === "zapmail" ? "Zapmail" : "Mission Inbox"} CSV`}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Connected mailboxes
            {channels.length > 0 && (
              <Badge variant="secondary">{channels.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            When you send a reply with an attachment, LeadBox uses the matching mailbox here to send it directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : channels.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <ServerCrash className="h-8 w-8 opacity-40" />
              <p className="text-sm">No mailboxes connected yet.</p>
              <p className="text-xs">Upload a CSV above to get started.</p>
            </div>
          ) : (
            <div className="divide-y">
              {channels.map((ch) => (
                <div key={ch.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{ch.email}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {ch.smtpHost}:{ch.smtpPort}
                        {ch.displayName ? ` · ${ch.displayName}` : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => deleteMutation.mutate(ch.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
