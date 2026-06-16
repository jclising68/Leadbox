"use client";

import { useState, useEffect } from "react";
import { useCurrentWorkspaceId } from "@/hooks/use-current-workspace";
import { useLabels } from "@/hooks/use-labels";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Loader2,
  TrendingUp,
  Megaphone,
  Trophy,
  Mail,
  Link2,
  Globe,
  Filter,
  Info,
  AlertTriangle,
  Ban,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type ReportData = {
  summary: { totalReplies: number; topCampaign: string | null; topStep: string | null };
  replyVolume: { date: string; replies: number }[];
  topCampaigns: { name: string; replies: number }[];
  topTitles: { title: string; replies: number }[];
  stepPerformance: { step: string; replies: number }[];
  labelDistribution: { label: string; count: number; color: string }[];
};

type BounceData = {
  summary: { totalBounced: number; totalUnsubscribed: number; total: number };
  byCampaign: { name: string; count: number }[];
  byDomain: { domain: string; count: number }[];
  leads: { email: string; company: string; campaign: string; reason: "Bounced" | "Unsubscribed"; date: string | null }[];
  insight: string[] | null;
};

type SourceFilter = "all" | "EMAIL" | "LINKEDIN";

// ── Helpers ───────────────────────────────────────────────────────────────

function getLast6Months() {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    months.push({ value, label });
  }
  return months;
}

function formatDay(dateStr: string) {
  return String(new Date(dateStr + "T00:00:00").getDate());
}

function generateInsight(type: string, data: ReportData): string {
  switch (type) {
    case "volume": {
      if (!data.replyVolume.length) return "No replies recorded this period.";
      const peak = data.replyVolume.reduce((a, b) => (a.replies > b.replies ? a : b));
      const total = data.replyVolume.reduce((s, d) => s + d.replies, 0);
      const avg = (total / data.replyVolume.length).toFixed(1);
      const peakDate = new Date(peak.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `Your busiest day was ${peakDate} with ${peak.replies} replies. You average ${avg} replies per active day — consistent activity means your sequences are running smoothly.`;
    }
    case "campaigns": {
      if (!data.topCampaigns.length) return "No campaign data available for this period.";
      const top = data.topCampaigns[0];
      const total = data.topCampaigns.reduce((s, c) => s + c.replies, 0);
      const pct = Math.round((top.replies / total) * 100);
      return `"${top.name}" drives ${pct}% of all replies this month. The campaigns below it may benefit from messaging updates or a fresh audience.`;
    }
    case "titles": {
      if (!data.topTitles.length) return "No title data available for this period.";
      const top = data.topTitles[0];
      const count = data.topTitles.length;
      return `${top.title}s reply most often. ${count > 3 ? `You're getting traction across ${count} different seniority levels, which shows your value prop resonates broadly.` : "Focus your ICP tightening on these high-responding titles."}`;
    }
    case "steps": {
      if (!data.stepPerformance.length) return "No step data available for this period.";
      const top = data.stepPerformance[0];
      const total = data.stepPerformance.reduce((s, x) => s + x.replies, 0);
      const pct = Math.round((top.replies / total) * 100);
      return `${top.step} accounts for ${pct}% of replies. ${pct > 60 ? "Most leads convert early — your opening message is doing the heavy lifting." : "Replies are spread across steps, which means your follow-up sequence is adding real value."}`;
    }
    case "labels": {
      if (!data.labelDistribution.length) return "No labeled threads yet. Apply labels in the inbox to start tracking outcomes.";
      const total = data.labelDistribution.reduce((s, l) => s + l.count, 0);
      const top = data.labelDistribution[0];
      const topPct = Math.round((top.count / total) * 100);
      const interested = data.labelDistribution.find((l) => {
        const n = l.label.toLowerCase();
        return n === "interested" || (n.includes("interest") && !n.includes("not"));
      });
      const interestedPct = interested ? Math.round((interested.count / total) * 100) : 0;

      // Lead with the dominant outcome, then mention Interested conversion rate
      const topLine = `"${top.label}" is your most common outcome at ${topPct}%.`;
      if (interested && interestedPct >= 20) {
        return `${topLine} ${interestedPct}% of tagged replies are Interested — solid conversion rate worth doubling down on.`;
      } else if (interested && interestedPct > 0) {
        return `${topLine} Only ${interestedPct}% are Interested — review your targeting and messaging to improve that ratio.`;
      }
      return `${topLine} Review these outcomes to find patterns in how leads are responding and where to focus next.`;
    }
    default:
      return "";
  }
}

// ── Shared tooltip ────────────────────────────────────────────────────────

const ChartTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; name: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg text-xs z-50">
      {label && <p className="font-medium text-foreground mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-muted-foreground">
          {p.name}:{" "}
          <span className="text-foreground font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ── Empty state ───────────────────────────────────────────────────────────

function EmptyChart() {
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <div className="h-10 w-10 rounded-full bg-muted/60 flex items-center justify-center">
        <Info className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground text-center">
        No data for this period.
        <br />
        Try selecting a different month or filter.
      </p>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  insight,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  insight: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card overflow-hidden ${className}`}
    >
      {/* Card header */}
      <div className="px-5 pt-5 pb-4 border-b border-border/60">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>

      {/* Chart area */}
      <div className="px-5 pt-5 pb-4">{children}</div>

      {/* Insight footer */}
      {insight && (
        <div className="mx-5 mb-5 rounded-lg bg-muted/40 border border-border/50 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">What this means: </span>
            {insight}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Horizontal bar chart ──────────────────────────────────────────────────

function HBarChart({
  data,
  dataKey,
  nameKey,
  color = "#3b82c4",
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  nameKey: string;
  color?: string;
}) {
  if (!data.length) return <EmptyChart />;
  const h = Math.max(180, data.length * 40);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 20, bottom: 0, left: 4 }}
        barCategoryGap="35%"
      >
        <CartesianGrid
          strokeDasharray="3 3"
          horizontal={false}
          stroke="var(--border)"
        />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey={nameKey}
          width={140}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 18) + "…" : v)}
        />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: "var(--accent)", opacity: 0.35 }}
        />
        <Bar dataKey={dataKey} fill={color} radius={[0, 5, 5, 0]} name="Replies" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Custom donut legend ───────────────────────────────────────────────────

function DonutLegend({
  items,
}: {
  items: { label: string; count: number; color: string }[];
}) {
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
      {items.map((item, i) => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
        return (
          <div key={i} className="flex items-center gap-2 min-w-0">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: item.color || `hsl(${(i * 47) % 360}, 60%, 55%)` }}
            />
            <span className="text-[11px] text-muted-foreground truncate flex-1">
              {item.label}
            </span>
            <span className="text-[11px] font-semibold text-foreground shrink-0">
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = "#3b82c4",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <div
          className="rounded-lg p-2"
          style={{ backgroundColor: `${accent}18` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
        </div>
      </div>
      <p
        className="text-3xl font-bold leading-none tracking-tight"
        style={{ color: "var(--foreground)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs text-muted-foreground mt-2 truncate">{sub}</p>
      )}
    </div>
  );
}

// ── Source toggle ─────────────────────────────────────────────────────────

function SourceToggle({
  value,
  onChange,
}: {
  value: SourceFilter;
  onChange: (v: SourceFilter) => void;
}) {
  const opts: { v: SourceFilter; label: string; icon: React.ElementType }[] = [
    { v: "all", label: "All", icon: Globe },
    { v: "EMAIL", label: "Email", icon: Mail },
    { v: "LINKEDIN", label: "LinkedIn", icon: Link2 },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`flex items-center gap-1.5 rounded-md px-3 h-7 text-xs font-medium transition-all ${
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <o.icon className="h-3 w-3" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function ReportingPage() {
  const workspaceId = useCurrentWorkspaceId();
  const months = getLast6Months();
  const { data: labels = [] } = useLabels();

  const [selectedMonth, setSelectedMonth] = useState(months[0].value);
  const [source, setSource] = useState<SourceFilter>("all");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bounceData, setBounceData] = useState<BounceData | null>(null);
  const [bounceLoading, setBounceLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ month: selectedMonth });
    if (source !== "all") params.set("source", source);
    if (selectedLabel) params.set("label", selectedLabel);

    fetch(`/api/reporting/overview?${params}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load report");
        return r.json();
      })
      .then((d: ReportData) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspaceId, selectedMonth, source, selectedLabel]);

  useEffect(() => {
    if (!workspaceId) return;
    setBounceLoading(true);
    const params = new URLSearchParams({ month: selectedMonth });
    fetch(`/api/reporting/bounces?${params}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BounceData | null) => setBounceData(d))
      .catch(() => setBounceData(null))
      .finally(() => setBounceLoading(false));
  }, [workspaceId, selectedMonth]);

  const labelList = (labels as { id: string; name: string }[]);

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-6xl mx-auto px-6 py-6 pb-10">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Reporting</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Understand what&apos;s driving replies — by campaign, title, step, and outcome.
        </p>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6 p-3 rounded-xl border border-border bg-card">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

        {/* Month */}
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        {/* Source */}
        <SourceToggle value={source} onChange={setSource} />

        {/* Label filter */}
        {labelList.length > 0 && (
          <select
            value={selectedLabel}
            onChange={(e) => setSelectedLabel(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All Labels</option>
            {labelList.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        )}

        {/* Active filter indicators */}
        {(source !== "all" || selectedLabel) && (
          <button
            onClick={() => { setSource("all"); setSelectedLabel(""); }}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-28 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Loading report…</p>
        </div>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Content ── */}
      {!loading && data && (
        <div className="space-y-5">

          {/* Stat row */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              icon={TrendingUp}
              label="Total Replies"
              value={data.summary.totalReplies}
              sub="Inbound replies this period"
              accent="#3b82c4"
            />
            <StatCard
              icon={Megaphone}
              label="Top Campaign"
              value={data.summary.topCampaign ?? "—"}
              sub="Highest reply volume"
              accent="#8b5cf6"
            />
            <StatCard
              icon={Trophy}
              label="Best Step"
              value={data.summary.topStep ?? "—"}
              sub="Most replies at this step"
              accent="#10b981"
            />
          </div>

          {/* Reply Volume — full width */}
          <SectionCard
            title="Reply Volume"
            subtitle="Number of inbound replies per day this month"
            insight={generateInsight("volume", data)}
          >
            {data.replyVolume.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={data.replyVolume}
                  margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                  barCategoryGap="45%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border)"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDay}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={1}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ fill: "var(--accent)", opacity: 0.35 }}
                  />
                  <Bar
                    dataKey="replies"
                    fill="#3b82c4"
                    radius={[3, 3, 0, 0]}
                    name="Replies"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          {/* Campaigns + Titles — 2 col */}
          <div className="grid grid-cols-2 gap-4">
            <SectionCard
              title="Top Campaigns"
              subtitle="Which campaigns generate the most replies"
              insight={generateInsight("campaigns", data)}
            >
              <HBarChart
                data={data.topCampaigns}
                dataKey="replies"
                nameKey="name"
                color="#3b82c4"
              />
            </SectionCard>

            <SectionCard
              title="Top Job Titles"
              subtitle="Which prospect titles reply most often"
              insight={generateInsight("titles", data)}
            >
              <HBarChart
                data={data.topTitles}
                dataKey="replies"
                nameKey="title"
                color="#8b5cf6"
              />
            </SectionCard>
          </div>

          {/* Step Performance + Label Distribution — 2 col */}
          <div className="grid grid-cols-2 gap-4">
            <SectionCard
              title="Step Performance"
              subtitle="At which sequence step do most replies happen"
              insight={generateInsight("steps", data)}
            >
              {data.stepPerformance.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(180, data.stepPerformance.length * 52)}
                >
                  <BarChart
                    data={data.stepPerformance}
                    margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                    barCategoryGap="40%"
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="var(--border)"
                    />
                    <XAxis
                      dataKey="step"
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ fill: "var(--accent)", opacity: 0.35 }}
                    />
                    <Bar
                      dataKey="replies"
                      fill="#10b981"
                      radius={[3, 3, 0, 0]}
                      name="Replies"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard
              title="Response Labels"
              subtitle="How your replies are categorized across all time"
              insight={generateInsight("labels", data)}
            >
              {data.labelDistribution.length === 0 ? (
                <EmptyChart />
              ) : (
                <>
                  {/* Donut — no recharts Legend, fixed height */}
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={data.labelDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={82}
                        paddingAngle={2}
                        dataKey="count"
                        nameKey="label"
                        strokeWidth={0}
                      >
                        {data.labelDistribution.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={
                              entry.color ||
                              `hsl(${(i * 47) % 360}, 60%, 55%)`
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]
                            .payload as { label: string; count: number };
                          return (
                            <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md text-xs">
                              <p className="font-medium">{d.label}</p>
                              <p className="text-muted-foreground">
                                Count:{" "}
                                <span className="text-foreground font-semibold">
                                  {d.count}
                                </span>
                              </p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Custom legend — outside chart, no overflow */}
                  <DonutLegend items={data.labelDistribution} />
                </>
              )}
            </SectionCard>
          </div>

          {/* Deliverability Health */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-border/60 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Deliverability Health</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Bounced leads and unsubscribes detected this period</p>
              </div>
            </div>

            {bounceLoading && (
              <div className="flex items-center justify-center py-12 gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Loading…</p>
              </div>
            )}

            {!bounceLoading && bounceData && (
              <div className="p-5 space-y-5">
                {/* Stat row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-start justify-between mb-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bounced</p>
                      <div className="rounded-lg p-2" style={{ backgroundColor: "#ef444418" }}>
                        <Ban className="h-3.5 w-3.5" style={{ color: "#ef4444" }} />
                      </div>
                    </div>
                    <p className="text-3xl font-bold leading-none tracking-tight text-foreground">
                      {bounceData.summary.totalBounced}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">Email bounces this period</p>
                  </div>

                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-start justify-between mb-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unsubscribed</p>
                      <div className="rounded-lg p-2" style={{ backgroundColor: "#f9731618" }}>
                        <AlertTriangle className="h-3.5 w-3.5" style={{ color: "#f97316" }} />
                      </div>
                    </div>
                    <p className="text-3xl font-bold leading-none tracking-tight text-foreground">
                      {bounceData.summary.totalUnsubscribed}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">Opted out this period</p>
                  </div>
                </div>

                {/* AI Action Items */}
                {bounceData.insight && bounceData.insight.length > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">Suggested actions</p>
                    <ul className="space-y-1.5">
                      {bounceData.insight.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-foreground leading-relaxed">
                          <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold">
                            {i + 1}
                          </span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Charts row */}
                {bounceData.summary.total > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
                    {/* By Campaign */}
                    <div>
                      <p className="text-xs font-medium text-foreground mb-3">By Campaign</p>
                      {bounceData.byCampaign.length === 0 ? (
                        <EmptyChart />
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(140, bounceData.byCampaign.length * 40)}>
                          <BarChart
                            data={bounceData.byCampaign}
                            layout="vertical"
                            margin={{ top: 0, right: 20, bottom: 0, left: 4 }}
                            barCategoryGap="35%"
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                            <XAxis
                              type="number"
                              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                              axisLine={false}
                              tickLine={false}
                              allowDecimals={false}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={140}
                              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 18) + "…" : v)}
                            />
                            <Tooltip
                              content={<ChartTooltip />}
                              cursor={{ fill: "var(--accent)", opacity: 0.35 }}
                            />
                            <Bar dataKey="count" fill="#ef4444" radius={[0, 5, 5, 0]} name="Issues" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* By Domain */}
                    <div>
                      <p className="text-xs font-medium text-foreground mb-3">By Domain</p>
                      {bounceData.byDomain.length === 0 ? (
                        <EmptyChart />
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(140, bounceData.byDomain.length * 40)}>
                          <BarChart
                            data={bounceData.byDomain}
                            layout="vertical"
                            margin={{ top: 0, right: 20, bottom: 0, left: 4 }}
                            barCategoryGap="35%"
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                            <XAxis
                              type="number"
                              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                              axisLine={false}
                              tickLine={false}
                              allowDecimals={false}
                            />
                            <YAxis
                              type="category"
                              dataKey="domain"
                              width={140}
                              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 18) + "…" : v)}
                            />
                            <Tooltip
                              content={<ChartTooltip />}
                              cursor={{ fill: "var(--accent)", opacity: 0.35 }}
                            />
                            <Bar dataKey="count" fill="#f97316" radius={[0, 5, 5, 0]} name="Issues" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <TrendingUp className="h-4 w-4 text-emerald-500" />
                    </div>
                    <p className="text-sm font-medium text-foreground">All clear this period</p>
                    <p className="text-xs text-muted-foreground text-center">No bounces or unsubscribes detected.</p>
                  </div>
                )}

                {/* Lead table */}
                {bounceData.leads.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-foreground mb-2">Affected Leads</p>
                    <div className="rounded-lg border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Email</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Company</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Campaign</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reason</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Detected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bounceData.leads.map((lead, i) => (
                            <tr
                              key={i}
                              className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                            >
                              <td className="px-3 py-2 text-foreground font-medium truncate max-w-[160px]">
                                {lead.email || "—"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">
                                {lead.company || "—"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">
                                {lead.campaign || "—"}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    lead.reason === "Bounced"
                                      ? "bg-red-500/10 text-red-500"
                                      : "bg-orange-500/10 text-orange-500"
                                  }`}
                                >
                                  {lead.reason}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                                {lead.date
                                  ? new Date(lead.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {bounceData.leads.length === 50 && (
                        <p className="text-[10px] text-muted-foreground text-center py-2 border-t border-border/50">
                          Showing most recent 50 — export for full list
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Coming soon footer */}
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-4">
            <p className="text-xs font-semibold text-foreground mb-1">
              Industry & Location — Coming Soon
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Once enrichment populates industry and location fields for your
              prospects, you&apos;ll see breakdowns here showing which industries and
              geographies respond best to your outreach.
            </p>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
