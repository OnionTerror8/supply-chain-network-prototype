"use client";

import { Fragment } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis, Legend } from "recharts";
import { ArrowDownRight, ArrowUpRight, Check, FlaskConical, GitCompareArrows, Minus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfidenceBadge } from "@/components/shared/badges";
import { EmptyState, SectionTitle } from "@/components/shared/kpi";
import { useWorkspace } from "@/lib/store";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/domain/helpers";
import type { ComparisonRow } from "@/lib/engine/scenarios";
import type { ScenarioChange } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const GROUP_LABEL: Record<ComparisonRow["group"], string> = { financial: "Financial", service: "Service & lead time", operational: "Operational", risk: "Risk & resilience", sustainability: "Sustainability", confidence: "Data confidence" };

export function CompareView() {
  const baseline = useWorkspace((s) => s.baseline);
  const scenarios = useWorkspace((s) => s.scenarios);
  const results = useWorkspace((s) => s.scenarioResults);
  const activeId = useWorkspace((s) => s.activeScenarioId);
  const setActive = useWorkspace((s) => s.setActiveScenario);
  const confirm = useWorkspace((s) => s.confirmScenario);
  const discard = useWorkspace((s) => s.discardScenario);
  const promote = useWorkspace((s) => s.promoteScenario);
  const sendMessage = useWorkspace((s) => s.sendMessage);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  const setView = useWorkspace((s) => s.setView);
  const changeLog = useWorkspace((s) => s.changeLog);
  if (!baseline) return null;
  const cur = baseline.currency;

  if (!scenarios.length) {
    return (
      <EmptyState
        icon={GitCompareArrows}
        title="No scenarios yet"
        body="Scenarios are immutable change lists applied on top of the baseline, so the baseline is never edited silently. Ask the agent to model one, or apply a suggested scenario from a finding."
        action={
          <div className="flex flex-wrap justify-center gap-1.5">
            {["What happens if we add a regional DC in Birmingham?", "Show me a cross-dock alternative for fast-moving lines", "What if we lose the Dover port for two weeks?"].map((q) => (
              <button key={q} onClick={() => { setAgentOpen(true); void sendMessage(q); }} className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10">{q}</button>
            ))}
          </div>
        }
      />
    );
  }

  const selected = scenarios.find((s) => s.id === activeId) ?? scenarios[scenarios.length - 1];
  const r = results[selected.id];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 pb-24 md:p-6 md:pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Baseline</span>
        <span className="text-muted-foreground">vs</span>
        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((s) => (
            <button key={s.id} onClick={() => setActive(s.id)} className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", s.id === selected.id ? "border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-card text-muted-foreground hover:text-foreground")}>
              <FlaskConical className="size-3" />{s.name}
              <span className="text-[9px] uppercase opacity-70">{s.status}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {selected.status === "draft" ? (
            <Tooltip><TooltipTrigger asChild><Button size="sm" variant="outline" onClick={() => { confirm(selected.id); toast.success("Scenario confirmed for review"); }}><Check />Confirm</Button></TooltipTrigger><TooltipContent>Mark this scenario as reviewed. It stays separate from the baseline.</TooltipContent></Tooltip>
          ) : (
            <Tooltip><TooltipTrigger asChild><Button size="sm" onClick={() => { promote(selected.id); setView("overview"); toast.success("Scenario promoted to baseline", { description: "Recorded in the audit log" }); }}><Upload />Promote to baseline</Button></TooltipTrigger><TooltipContent>Replace the baseline with this scenario’s network. Approver role in production.</TooltipContent></Tooltip>
          )}
          <Button size="sm" variant="ghost" onClick={() => { discard(selected.id); toast("Scenario discarded"); }}><Trash2 />Discard</Button>
        </div>
      </div>

      {!r ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm">This scenario could not be evaluated against the current baseline.</div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">{selected.name}</h2>
                  <p className="text-xs text-muted-foreground">{selected.description} · created by {selected.createdBy} · {new Date(selected.createdAt).toLocaleString()}</p>
                </div>
                <ConfidenceBadge confidence={r.comparison.confidence} size="md" />
              </div>
              <p className="mt-3 text-sm leading-relaxed">{r.comparison.headline}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <List title="Benefits" items={r.comparison.benefits} tone="good" />
                <List title="Trade-offs" items={r.comparison.tradeOffs} tone="bad" />
                <List title="Limitations of this analysis" items={r.comparison.limitations} />
                <List title="Enablers required" items={r.comparison.enablers} />
              </div>
              <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">{r.comparison.confidenceNote}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <SectionTitle>Changes applied to baseline</SectionTitle>
              <ol className="space-y-1.5 text-xs">
                {selected.changes.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-amber-500/15 text-[9px] font-semibold text-amber-700 dark:text-amber-300">{i + 1}</span>
                    <span>{describeChange(c, baseline)}</span>
                  </li>
                ))}
              </ol>
              {r.log.length ? (
                <>
                  <SectionTitle className="mt-4">Engine log</SectionTitle>
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-muted-foreground scrollbar-thin">
                    {r.log.map((l, i) => <li key={i}>• {l}</li>)}
                  </ul>
                </>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <div className="rounded-xl border bg-card lg:col-span-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-[10px] tracking-wider text-muted-foreground uppercase">
                    <th className="px-4 py-2 text-left font-semibold">Metric</th>
                    <th className="px-2 py-2 text-right font-semibold">Baseline</th>
                    <th className="px-2 py-2 text-right font-semibold">Scenario</th>
                    <th className="px-4 py-2 text-right font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(GROUP_LABEL) as ComparisonRow["group"][]).map((g) => {
                    const rows = r.comparison.rows.filter((x) => x.group === g);
                    if (!rows.length) return null;
                    return (
                      <Fragment key={g}>
                        <tr className="bg-muted/40"><td colSpan={4} className="px-4 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{GROUP_LABEL[g]}</td></tr>
                        {rows.map((row) => <Row key={row.key} row={row} cur={cur} />)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border bg-card p-4 lg:col-span-2">
              <SectionTitle>Cost components</SectionTitle>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.comparison.costLines.filter((c) => c.baseline || c.scenario)} layout="vertical" margin={{ left: 4, right: 12 }}>
                    <XAxis type="number" tickFormatter={(v) => fmtMoney(v, cur)} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <ChartTooltip cursor={{ fill: "var(--muted)" }} formatter={(v) => fmtMoney(Number(v), cur)} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="baseline" name="Baseline" fill="#94a3b8" radius={2} barSize={7} />
                    <Bar dataKey="scenario" name="Scenario" fill="#f59e0b" radius={2} barSize={7} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <SectionTitle>Scenario history</SectionTitle>
            <ul className="space-y-1 text-xs">
              {changeLog.filter((l) => l.scenarioId === selected.id).map((l) => (
                <li key={l.id} className="flex gap-3">
                  <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{new Date(l.at).toLocaleString()}</span>
                  <span className="w-12 shrink-0 capitalize text-muted-foreground">{l.actor}</span>
                  <span>{l.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ row, cur }: { row: ComparisonRow; cur: string }) {
  const fmt = (v: number) => (row.format === "money" ? fmtMoney(v, cur, Math.abs(v) >= 1000) : row.format === "pct" ? fmtPct(v, 1) : row.format === "days" ? `${v.toFixed(1)} d` : row.format === "tonnes" ? `${fmtNum(v)} t` : row.format === "kg" ? `${v.toFixed(2)} kg` : row.format === "score" ? v.toFixed(0) : fmtNum(v));
  const neutral = Math.abs(row.delta) < 1e-9 || (row.baseline && Math.abs(row.deltaPct) < 0.0005);
  const good = row.betterWhen === "lower" ? row.delta < 0 : row.delta > 0;
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-1.5">{row.label}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(row.baseline)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(row.scenario)}</td>
      <td className="px-4 py-1.5 text-right">
        <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 tabular-nums", neutral ? "text-muted-foreground" : good ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/12 text-rose-700 dark:text-rose-400")}>
          {neutral ? <Minus className="size-3" /> : row.delta > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {row.format === "pct" ? `${(row.delta * 100).toFixed(1)} pts` : `${row.delta > 0 ? "+" : ""}${fmt(row.delta)}`}
          {row.baseline && row.format !== "pct" && row.format !== "score" ? <span className="ml-1 opacity-70">({(row.deltaPct * 100).toFixed(1)}%)</span> : null}
        </span>
      </td>
    </tr>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: "good" | "bad" }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</div>
      {items.length ? (
        <ul className="space-y-1 text-xs">
          {items.map((it, i) => (
            <li key={i} className="flex gap-1.5">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone === "good" ? "bg-emerald-500" : tone === "bad" ? "bg-rose-500" : "bg-muted-foreground/50")} />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground italic">None identified</div>
      )}
    </div>
  );
}

export function describeChange(c: ScenarioChange, model: { nodes: { id: string; name: string }[]; lanes: { id: string; from: string; to: string }[]; productFamilies: { id: string; name: string }[]; regions: { id: string; name: string }[] }) {
  const n = (id: string) => model.nodes.find((x) => x.id === id)?.name ?? id;
  const fam = (id: string) => model.productFamilies.find((x) => x.id === id)?.name ?? id;
  switch (c.type) {
    case "add_node": return `Add ${c.node.name} (${c.node.type.replace("_", " ")})${c.feedFrom ? ` fed from ${n(c.feedFrom)}` : ""}${c.serveNearest?.length ? ", serving nearest customers" : ""}`;
    case "remove_node": return `Remove ${n(c.nodeId)}${c.reassign ? " and reassign its flows" : ""}`;
    case "update_node": return `Update ${n(c.nodeId)}: ${c.label}`;
    case "add_lane": return `Add lane ${n(c.lane.from)} → ${n(c.lane.to)}`;
    case "remove_lane": { const l = model.lanes.find((x) => x.id === c.laneId); return l ? `Remove lane ${n(l.from)} → ${n(l.to)}` : `Remove lane ${c.laneId}`; }
    case "update_lane": return `Update lane: ${c.label}`;
    case "demand_change": return c.label;
    case "direct_to_store": return `Deliver ${fam(c.productFamilyId)} direct from ${c.fromType.replace("_", " ")} to customers`;
    case "convert_to_cross_dock": return `Cross-dock ${c.productFamilyIds.map(fam).join(", ")} through ${c.nodeIds.map(n).join(", ")}`;
    case "move_channel": return `Move ${c.channel} fulfilment from ${n(c.from)} to ${n(c.to)}`;
    case "add_rule": return `Add rule: ${c.rule.text}`;
  }
}
