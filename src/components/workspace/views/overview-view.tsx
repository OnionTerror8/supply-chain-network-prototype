"use client";

import { useMemo } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, FlaskConical, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kpi, SectionTitle } from "@/components/shared/kpi";
import { ConfidenceBadge, ProvenanceLegend } from "@/components/shared/badges";
import { FindingSummary } from "@/components/shared/finding-card";
import { OverviewSchematic } from "../overview-schematic";
import { useActive, useWorkspace } from "@/lib/store";
import { COST_COMPONENT_LABEL, NODE_TYPE_META, PROVENANCE_LABEL, type Provenance } from "@/lib/domain/types";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/domain/helpers";
import { costToServe } from "@/lib/engine/metrics";
import { PROVENANCE_HEX } from "@/lib/filters";
import { executiveSummary } from "@/lib/agent/rule-agent";

export function OverviewView() {
  const { model, metrics, findings, baselineMetrics, scenario, isScenario, result } = useActive();
  const scenarios = useWorkspace((s) => s.scenarios);
  const scenarioResults = useWorkspace((s) => s.scenarioResults);
  const select = useWorkspace((s) => s.select);
  const setView = useWorkspace((s) => s.setView);
  const setActiveScenario = useWorkspace((s) => s.setActiveScenario);
  const sendMessage = useWorkspace((s) => s.sendMessage);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  const selection = useWorkspace((s) => s.selection);
  const horizon = useWorkspace((s) => s.filters.horizon);

  const provenanceMix = useMemo(() => {
    if (!model) return [];
    const counts: Record<Provenance, number> = { confirmed: 0, user: 0, assumed: 0, ai: 0, missing: 0 };
    for (const n of model.nodes) for (const t of [n.capacityPerWeek, n.inventoryDays, n.fixedCostPerYear, n.handlingCostPerCase, n.reliability]) counts[t?.source ?? "missing"]++;
    for (const l of model.lanes) for (const t of [l.volumePerWeek, l.costPerCase, l.transitDays, l.reliability]) counts[t?.source ?? "missing"]++;
    return (Object.keys(counts) as Provenance[]).map((k) => ({ name: PROVENANCE_LABEL[k], key: k, value: counts[k] }));
  }, [model]);

  if (!model || !metrics) return null;
  const cur = model.currency;
  const cts = costToServe(metrics);
  const base = baselineMetrics ?? metrics;
  const d = (a: number, b: number) => (isScenario ? a - b : undefined);
  const costData = metrics.costLines.filter((l) => l.component !== "procurement").map((l) => ({ name: COST_COMPONENT_LABEL[l.component], value: l.annual, confidence: l.confidence, baseline: base.costLines.find((x) => x.component === l.component)?.annual ?? 0 }));
  const top = [...findings].filter((f) => f.category !== "data_quality").sort((a, b) => sevRank(b.severity) - sevRank(a.severity)).slice(0, 5);
  const typeCounts = Object.entries(model.nodes.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n.type]: (acc[n.type] ?? 0) + 1 }), {}));
  const summary = executiveSummary(model, metrics, findings);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 pb-24 md:p-6 md:pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{model.name}</h1>
            {isScenario ? <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Scenario: {scenario?.name}</span> : <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Baseline</span>}
            {horizon === "peak" ? <span className="rounded-md bg-rose-500/12 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">Seasonal peak week</span> : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{model.description ?? `${model.nodes.length} nodes and ${model.lanes.length} lanes across ${model.productFamilies.length} product families.`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceBadge confidence={metrics.dataConfidence} size="md" />
          <Button size="sm" variant="outline" onClick={() => { setAgentOpen(true); void sendMessage("Explain the network to an executive"); }}><ScrollText />Executive brief</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Cost-to-serve" value={fmtMoney(cts, cur)} raw={cts} format={(n) => fmtMoney(n, cur)} sub={`${fmtMoney(metrics.costPerCase, cur, false)} per case`} delta={d(cts, costToServe(base))} deltaLabel={isScenario ? fmtMoney(cts - costToServe(base), cur) : undefined} good={cts <= costToServe(base)} hint="Warehousing, transport, last mile, cross-dock, inventory carrying, duties, waste and service-failure cost. Excludes procurement, manufacturing and the carbon shadow price." accent="#1f3d4d" />
        <Kpi label="Service level" value={fmtPct(metrics.serviceLevel, 1)} raw={metrics.serviceLevel} format={(n) => fmtPct(n, 1)} sub={`${metrics.avgLeadTimeDays.toFixed(1)} day avg lead time`} delta={d(metrics.serviceLevel, base.serviceLevel)} deltaLabel={isScenario ? `${((metrics.serviceLevel - base.serviceLevel) * 100).toFixed(1)} pts` : undefined} good={metrics.serviceLevel >= base.serviceLevel} hint="Volume-weighted on-time-in-full to customer-facing nodes, penalised by lane and facility reliability and congestion." accent="#3d7a4a" />
        <Kpi label="Inventory" value={fmtMoney(metrics.inventoryValue, cur)} raw={metrics.inventoryValue} format={(n) => fmtMoney(n, cur)} sub={`${metrics.inventoryDaysWeighted.toFixed(1)} days weighted`} delta={d(metrics.inventoryValue, base.inventoryValue)} deltaLabel={isScenario ? fmtMoney(metrics.inventoryValue - base.inventoryValue, cur) : undefined} good={metrics.inventoryValue <= base.inventoryValue} accent="#2a6a78" />
        <Kpi label="Utilisation" value={fmtPct(metrics.avgUtilisation)} raw={metrics.avgUtilisation} format={(n) => fmtPct(n)} sub={`${metrics.constrainedNodes} constrained node${metrics.constrainedNodes === 1 ? "" : "s"}`} delta={d(metrics.constrainedNodes, base.constrainedNodes)} deltaLabel={isScenario ? `${metrics.constrainedNodes - base.constrainedNodes} constrained` : undefined} good={metrics.constrainedNodes <= base.constrainedNodes} accent="#c2782a" />
        <Kpi label="Risk score" value={`${Math.round(metrics.riskScore)}`} raw={metrics.riskScore} format={(n) => `${Math.round(n)}`} sub={`resilience ${Math.round(metrics.resilienceScore)}/100`} delta={d(metrics.riskScore, base.riskScore)} deltaLabel={isScenario ? `${(metrics.riskScore - base.riskScore).toFixed(0)}` : undefined} good={metrics.riskScore <= base.riskScore} hint="Composite of single-source dependency, capacity headroom, lane reliability, border exposure and gateway concentration (0 = no risk)." accent="#9a4a2a" />
        <Kpi label="Carbon" value={`${fmtNum(metrics.emissionsTonnes)} t`} raw={metrics.emissionsTonnes} format={(n) => `${fmtNum(n)} t`} sub={`${metrics.emissionsPerCaseKg.toFixed(2)} kg per case`} delta={d(metrics.emissionsTonnes, base.emissionsTonnes)} deltaLabel={isScenario ? `${fmtNum(metrics.emissionsTonnes - base.emissionsTonnes)} t` : undefined} good={metrics.emissionsTonnes <= base.emissionsTonnes} accent="#0f6f73" />
      </div>

      {metrics.unservedCasesPerWeek > 0 ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm">
          <b className="font-semibold">{fmtNum(metrics.unservedCasesPerWeek)} cases per week cannot be served</b> because capacity is exceeded downstream. Check the Findings view for the constrained nodes.
        </div>
      ) : null}

      <OverviewSchematic
        model={model}
        metrics={metrics}
        selectedNodeId={selection?.nodeId}
        onSelectNode={(nodeId) => select({ nodeId })}
        onOpenMap={() => setView("map")}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border bg-card p-4 lg:col-span-3">
          <SectionTitle action={<Button variant="ghost" size="xs" onClick={() => setView("data")}>Calculation logic<ArrowRight /></Button>}>Annual operating cost by component</SectionTitle>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis type="number" tickFormatter={(v) => fmtMoney(v, cur)} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <ChartTooltip cursor={{ fill: "var(--muted)" }} content={({ payload }) => {
                  const p = payload?.[0]?.payload as (typeof costData)[number] | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                      <div className="font-medium">{p.name}</div>
                      <div className="tabular-nums">{fmtMoney(p.value, cur)} / yr</div>
                      {isScenario ? <div className="tabular-nums text-muted-foreground">baseline {fmtMoney(p.baseline, cur)}</div> : null}
                      <div className="mt-1 capitalize text-muted-foreground">{p.confidence} confidence</div>
                    </div>
                  );
                }} />
                {isScenario ? <Bar dataKey="baseline" fill="var(--muted-foreground)" opacity={0.25} radius={3} barSize={8} /> : null}
                <Bar dataKey="value" radius={3} barSize={isScenario ? 8 : 14}>
                  {costData.map((e, i) => <Cell key={i} fill={e.confidence === "high" ? "#1f3d4d" : e.confidence === "medium" ? "#2a6a78" : "#c4b59a"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[#1f3d4d]" />high confidence</span>
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[#2a6a78]" />medium</span>
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[#c4b59a]" />low / estimated</span>
            <span className="ml-auto">Goods purchased: {fmtMoney(metrics.procurementAnnual, cur)} (reported separately)</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 lg:col-span-2">
          <SectionTitle action={<Button variant="ghost" size="xs" onClick={() => setView("data")}>Improve data<ArrowRight /></Button>}>Data provenance</SectionTitle>
          <div className="flex items-center gap-4">
            <div className="h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={provenanceMix} dataKey="value" innerRadius={42} outerRadius={64} paddingAngle={2} stroke="none">
                    {provenanceMix.map((e) => <Cell key={e.key} fill={PROVENANCE_HEX[e.key]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5 text-xs">
              {provenanceMix.map((e) => {
                const total = provenanceMix.reduce((a, b) => a + b.value, 0);
                return (
                  <div key={e.key} className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: PROVENANCE_HEX[e.key] }} />
                    <span className="flex-1 truncate text-muted-foreground">{e.name}</span>
                    <span className="tabular-nums">{total ? Math.round((e.value / total) * 100) : 0}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Confidence score {Math.round(metrics.confidenceScore * 100)}%. Results are only as strong as the evidence behind them; replace assumed defaults with confirmed values where sensitivity is high.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionTitle action={<Button variant="ghost" size="xs" onClick={() => setView("findings")}>All {findings.length} findings<ArrowRight /></Button>}>Top pinchpoints & opportunities</SectionTitle>
          <div className="space-y-2">
            {top.map((f) => <FindingSummary key={f.id} f={f} model={model} selected={selection?.findingId === f.id} onClick={() => select({ findingId: f.id })} />)}
            {!top.length ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No material findings detected.</div> : null}
          </div>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border bg-card p-4">
            <SectionTitle action={<Button variant="ghost" size="xs" onClick={() => setView("compare")}>Compare<ArrowRight /></Button>}>Scenarios</SectionTitle>
            {scenarios.length ? (
              <div className="space-y-2">
                {scenarios.map((s) => {
                  const r = scenarioResults[s.id];
                  const delta = r?.comparison.netAnnualDelta ?? 0;
                  return (
                    <button key={s.id} onClick={() => { setActiveScenario(s.id); setView("compare"); }} className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left hover:border-primary/40">
                      <FlaskConical className="size-4 shrink-0 text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{s.name}</div>
                        <div className="truncate text-[10px] text-muted-foreground">{r?.comparison.headline ?? s.description}</div>
                      </div>
                      <span className={`text-xs font-semibold tabular-nums ${delta < 0 ? "text-emerald-600" : delta > 0 ? "text-rose-600" : "text-muted-foreground"}`}>{delta ? fmtMoney(delta, cur) : "—"}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No scenarios yet. Ask the agent, for example:
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["What happens if we add a regional DC in Birmingham?", "Show me a cross-dock alternative", "What if demand in the South East grows 25%?"].map((q) => (
                    <button key={q} onClick={() => { setAgentOpen(true); void sendMessage(q); }} className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10">{q}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-xl border bg-card p-4">
            <SectionTitle>Network composition</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {typeCounts.map(([t, c]) => (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px]">
                  <span className="size-2 rounded-full" style={{ background: NODE_TYPE_META[t as keyof typeof NODE_TYPE_META].color }} />
                  {c} {NODE_TYPE_META[t as keyof typeof NODE_TYPE_META].label}{c > 1 ? "s" : ""}
                </span>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">{model.productFamilies.length} product families · {model.regions.length} demand regions · {model.rules.filter((r) => r.active).length} active operating rules · {fmtNum(metrics.annualCases)} cases per year</div>
          </div>
          {isScenario && result ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-xs">
              <div className="mb-1 font-semibold">Scenario headline</div>
              <p>{result.comparison.headline}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <SectionTitle>Executive summary (agent-generated)</SectionTitle>
        <p className="text-sm leading-relaxed whitespace-pre-line">{summary}</p>
        <div className="mt-3"><ProvenanceLegend /></div>
      </div>
    </div>
  );
}

function sevRank(s: string) {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[s] ?? 0;
}
