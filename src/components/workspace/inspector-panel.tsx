"use client";

import { ArrowRight, MessageSquare, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ProvenanceBadge, SeverityBadge } from "@/components/shared/badges";
import { TaggedField } from "@/components/shared/tagged-field";
import { FindingDetail } from "@/components/shared/finding-card";
import { useActive, useWorkspace } from "@/lib/store";
import { NODE_TYPE_META, TIER_LABEL, type Lane, type NetworkNode, type Temperature, type TransportMode } from "@/lib/domain/types";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/domain/helpers";
import { nodeEvidence, laneEvidence } from "@/lib/filters";
import { cn } from "@/lib/utils";

export function InspectorPanel() {
  const selection = useWorkspace((s) => s.selection);
  const setInspectorOpen = useWorkspace((s) => s.setInspectorOpen);
  const { model, findings, baseline, isScenario } = useActive();
  if (!model || !selection) return null;
  const node = selection.nodeId ? model.nodes.find((n) => n.id === selection.nodeId) : undefined;
  const lane = selection.laneId ? model.lanes.find((l) => l.id === selection.laneId) : undefined;
  const finding = selection.findingId ? findings.find((f) => f.id === selection.findingId) : undefined;
  const ghostNode = !node && selection.nodeId && baseline ? baseline.nodes.find((n) => n.id === selection.nodeId) : undefined;

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[400px] flex-col border-l bg-card shadow-xl sm:w-[400px]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {node ? "Node" : lane ? "Lane" : finding ? "Finding" : ghostNode ? "Removed node" : "Details"}
          {isScenario ? <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 normal-case dark:text-amber-300">edits go to scenario</span> : null}
        </div>
        <Button variant="ghost" size="icon-xs" onClick={() => setInspectorOpen(false)} aria-label="Close"><X /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
        {node ? <NodeInspector node={node} /> : null}
        {lane ? <LaneInspector lane={lane} /> : null}
        {finding ? <FindingDetail f={finding} model={model} /> : null}
        {ghostNode ? (
          <div className="text-sm">
            <div className="font-medium">{ghostNode.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">This node exists in the baseline but is removed in the active scenario. Its flows have been reassigned to the nearest alternative.</p>
          </div>
        ) : null}
        {!node && !lane && !finding && !ghostNode ? <p className="text-xs text-muted-foreground">Nothing selected.</p> : null}
      </div>
    </div>
  );
}

function NodeInspector({ node }: { node: NetworkNode }) {
  const { model, metrics, findings } = useActive();
  const updateNode = useWorkspace((s) => s.updateNode);
  const removeNode = useWorkspace((s) => s.removeNode);
  const select = useWorkspace((s) => s.select);
  const sendMessage = useWorkspace((s) => s.sendMessage);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  if (!model) return null;
  const nm = metrics?.nodeMetrics[node.id];
  const meta = NODE_TYPE_META[node.type];
  const inbound = model.lanes.filter((l) => l.to === node.id);
  const outbound = model.lanes.filter((l) => l.from === node.id);
  const related = findings.filter((f) => f.impacted.nodeIds.includes(node.id));
  const name = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;
  const evidence = nodeEvidence(node);
  const ask = (q: string) => { setAgentOpen(true); void sendMessage(q); };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-white" style={{ background: meta.color }}>{meta.short}</span>
          <div className="min-w-0 flex-1">
            <Input defaultValue={node.name} key={node.id + node.name} onBlur={(e) => e.target.value.trim() && e.target.value !== node.name && updateNode(node.id, { name: e.target.value.trim() }, `renamed to ${e.target.value.trim()}`)} className="h-8 border-transparent px-1 text-base font-semibold shadow-none hover:border-input focus-visible:border-input" />
            <div className="px-1 text-xs text-muted-foreground">{meta.label} · {TIER_LABEL[meta.tier]} · {node.location.city ?? `${node.location.lat.toFixed(2)}, ${node.location.lng.toFixed(2)}`}, {node.location.country}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
          <ProvenanceBadge source={node.location.source} note="Location" />
          <span className="rounded-md border px-1.5 py-0.5 text-[10px] capitalize">{node.temperature}</span>
          {node.operator ? <span className="rounded-md border px-1.5 py-0.5 text-[10px]">{node.operator.value}</span> : null}
          {node.tags?.map((t) => <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]">{t}</span>)}
          <span className="ml-auto text-[10px] text-muted-foreground">{Math.round(evidence * 100)}% evidence-backed</span>
        </div>
        {node.notes ? <p className="mt-2 px-1 text-xs text-muted-foreground">{node.notes}</p> : null}
      </div>

      {nm ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Throughput / wk" value={fmtNum(nm.throughputPerWeek)} sub="cases" />
          <Stat label="Utilisation" value={nm.utilisation !== undefined ? fmtPct(nm.utilisation) : "—"} sub={nm.utilisation !== undefined ? (nm.utilisation >= 0.95 ? "critical" : nm.utilisation >= 0.85 ? "constrained" : nm.utilisation < 0.45 ? "under-used" : "healthy") : "no capacity data"} warn={nm.utilisation !== undefined && nm.utilisation >= 0.85} />
          <Stat label="Annual cost" value={fmtMoney(nm.annualCost, model.currency)} sub="fixed + handling + inventory" />
          <Stat label="Emissions" value={`${Math.round(nm.emissionsTonnes)} t`} sub="CO₂e / yr, facility share" />
          {nm.inventoryValue ? <Stat label="Inventory" value={fmtMoney(nm.inventoryValue, model.currency)} sub={`${fmtNum(nm.inventoryCases ?? 0)} cases`} /> : null}
          <Stat label="Inbound / outbound" value={`${fmtNum(nm.inboundPerWeek)} / ${fmtNum(nm.outboundPerWeek)}`} sub="cases per week" />
        </div>
      ) : null}

      <div>
        <Title>Operating data</Title>
        <div className="divide-y rounded-lg border px-3">
          <TaggedField label="Capacity per week" tagged={node.capacityPerWeek} format={(v) => fmtNum(v)} unit="cases" onChange={(t) => updateNode(node.id, { capacityPerWeek: t }, `capacity set to ${fmtNum(t.value)}/wk`)} />
          <TaggedField label="Inventory days" tagged={node.inventoryDays} format={(v) => v.toFixed(1)} unit="days" step={0.5} onChange={(t) => updateNode(node.id, { inventoryDays: t }, `inventory days set to ${t.value}`)} />
          <TaggedField label="Fixed cost per year" tagged={node.fixedCostPerYear} format={(v) => fmtMoney(v, model.currency)} onChange={(t) => updateNode(node.id, { fixedCostPerYear: t }, `fixed cost set to ${fmtMoney(t.value, model.currency)}`)} />
          <TaggedField label="Handling cost per case" tagged={node.handlingCostPerCase} format={(v) => fmtMoney(v, model.currency, false)} step={0.01} onChange={(t) => updateNode(node.id, { handlingCostPerCase: t }, `handling cost set to ${fmtMoney(t.value, model.currency, false)}`)} />
          <TaggedField label="Reliability (OTIF)" tagged={node.reliability} format={(v) => fmtPct(v, 1)} step={0.01} onChange={(t) => updateNode(node.id, { reliability: t }, `reliability set to ${fmtPct(t.value, 1)}`)} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Temperature regime</span>
          <Select value={node.temperature} onValueChange={(v) => updateNode(node.id, { temperature: v as Temperature }, `temperature set to ${v}`)}>
            <SelectTrigger size="sm" className="ml-auto h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{(["ambient", "chilled", "frozen", "multi"] as Temperature[]).map((t) => <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Title>Lanes ({inbound.length} in · {outbound.length} out)</Title>
        <div className="space-y-1">
          {[...inbound, ...outbound].map((l) => {
            const lm = metrics?.laneMetrics[l.id];
            const out = l.from === node.id;
            return (
              <button key={l.id} onClick={() => select({ laneId: l.id })} className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-xs hover:border-primary/50">
                <span className={cn("rounded px-1 text-[9px] font-semibold uppercase", out ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>{out ? "out" : "in"}</span>
                <span className="min-w-0 flex-1 truncate">{out ? name(l.to) : name(l.from)}</span>
                <span className="tabular-nums text-muted-foreground">{fmtNum(l.volumePerWeek.value)}/wk</span>
                {lm ? <span className="w-14 text-right tabular-nums">{fmtMoney(lm.annualCost, model.currency)}</span> : null}
              </button>
            );
          })}
          {!inbound.length && !outbound.length ? <p className="text-xs text-muted-foreground">No lanes connected. Draw one in the Network view or ask the agent.</p> : null}
        </div>
      </div>

      {related.length ? (
        <div>
          <Title>Findings ({related.length})</Title>
          <div className="space-y-1">
            {related.map((f) => (
              <button key={f.id} onClick={() => select({ findingId: f.id })} className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-xs hover:border-primary/50">
                <SeverityBadge severity={f.severity} />
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => ask(`What happens if we lose ${node.name}?`)}><Zap />What if we lose it?</Button>
        <Button size="sm" variant="outline" onClick={() => ask(`Explain the role, cost and risks of ${node.name} in our network.`)}><MessageSquare />Ask agent</Button>
        <Button size="sm" variant="destructive" onClick={() => removeNode(node.id)}><Trash2 />Remove</Button>
      </div>
    </div>
  );
}

function LaneInspector({ lane }: { lane: Lane }) {
  const { model, metrics, findings } = useActive();
  const updateLane = useWorkspace((s) => s.updateLane);
  const removeLane = useWorkspace((s) => s.removeLane);
  const select = useWorkspace((s) => s.select);
  const sendMessage = useWorkspace((s) => s.sendMessage);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  if (!model) return null;
  const lm = metrics?.laneMetrics[lane.id];
  const from = model.nodes.find((n) => n.id === lane.from);
  const to = model.nodes.find((n) => n.id === lane.to);
  const related = findings.filter((f) => f.impacted.laneIds.includes(lane.id));
  const fams = lane.productFamilies.length ? lane.productFamilies.map((id) => model.productFamilies.find((p) => p.id === id)?.name ?? id) : ["All families"];
  const evidence = laneEvidence(lane);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-base font-semibold">
          <button className="truncate hover:underline" onClick={() => from && select({ nodeId: from.id })}>{from?.name ?? lane.from}</button>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          <button className="truncate hover:underline" onClick={() => to && select({ nodeId: to.id })}>{to?.name ?? lane.to}</button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-md border px-1.5 py-0.5 text-[10px] capitalize">{lane.mode}</span>
          <span className="rounded-md border px-1.5 py-0.5 text-[10px] capitalize">{lane.temperature}</span>
          {lane.pattern ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]">{lane.pattern.replace("_", " ")}</span> : null}
          {lane.crossesBorder ? <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">crosses border</span> : null}
          <span className="ml-auto text-[10px] text-muted-foreground">{Math.round(evidence * 100)}% evidence-backed</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{fams.join(", ")}</div>
      </div>

      {lm ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Annual cost" value={fmtMoney(lm.annualCost, model.currency)} sub={`${fmtMoney(lm.costPerCase, model.currency, false)}/case · ${lm.costSource}`} />
          <Stat label="Distance" value={`${Math.round(lm.distanceKm)} km`} sub={`${lm.transitDays.toFixed(1)} days transit`} />
          <Stat label="Emissions" value={`${Math.round(lm.annualEmissionsTonnes)} t`} sub="CO₂e / yr" />
          <Stat label="Share of destination" value={fmtPct(lm.shareOfDestinationInbound)} sub="of inbound volume" warn={lm.shareOfDestinationInbound > 0.6} />
        </div>
      ) : null}

      <div>
        <Title>Lane data</Title>
        <div className="divide-y rounded-lg border px-3">
          <TaggedField label="Volume per week" tagged={lane.volumePerWeek} format={(v) => fmtNum(v)} unit="cases" onChange={(t) => updateLane(lane.id, { volumePerWeek: t }, `volume set to ${fmtNum(t.value)}/wk on ${from?.name} → ${to?.name}`)} />
          <TaggedField label="Cost per case" tagged={lane.costPerCase} format={(v) => fmtMoney(v, model.currency, false)} step={0.01} onChange={(t) => updateLane(lane.id, { costPerCase: t }, `cost per case set to ${fmtMoney(t.value, model.currency, false)} on ${from?.name} → ${to?.name}`)} hint="Leave blank to estimate from distance and mode" />
          <TaggedField label="Transit days" tagged={lane.transitDays} format={(v) => v.toFixed(1)} step={0.5} onChange={(t) => updateLane(lane.id, { transitDays: t }, `transit set to ${t.value} days on ${from?.name} → ${to?.name}`)} />
          <TaggedField label="Reliability (OTIF)" tagged={lane.reliability} format={(v) => fmtPct(v, 1)} step={0.01} onChange={(t) => updateLane(lane.id, { reliability: t }, `reliability set to ${fmtPct(t.value, 1)} on ${from?.name} → ${to?.name}`)} />
          <TaggedField label="Distance" tagged={lane.distanceKm} format={(v) => Math.round(v).toString()} unit="km" onChange={(t) => updateLane(lane.id, { distanceKm: t }, `distance set to ${Math.round(t.value)} km`)} hint="Computed from coordinates when not provided" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Mode</span>
          <Select value={lane.mode} onValueChange={(v) => updateLane(lane.id, { mode: v as TransportMode }, `mode set to ${v}`)}>
            <SelectTrigger size="sm" className="ml-auto h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{(["road", "rail", "sea", "air", "parcel", "van"] as TransportMode[]).map((t) => <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {lm?.costSource !== "confirmed" && lm ? (
        <div className="rounded-lg border border-dashed p-2.5 text-[11px] text-muted-foreground">
          Cost on this lane is <b className="font-medium text-foreground">{lm.costSource === "user" ? "user-entered" : "estimated"}</b>: {lm.costSource === "user" ? "entered manually in this workspace." : `distance (${Math.round(lm.distanceKm)} km) × ${lane.mode} rate ${fmtMoney(model.parameters.costPerCaseKm[lane.mode].value, model.currency, false)}/case-km + handling ${fmtMoney(model.parameters.laneHandlingPerCase.value, model.currency, false)}/case.`} Add a confirmed rate card value to raise confidence.
        </div>
      ) : null}

      <div>
        <Title>Products carried</Title>
        <div className="flex flex-wrap gap-1.5">
          {model.productFamilies.map((p) => {
            const on = lane.productFamilies.length === 0 || lane.productFamilies.includes(p.id);
            return (
              <button key={p.id} onClick={() => {
                const current = lane.productFamilies.length ? lane.productFamilies : model.productFamilies.map((x) => x.id);
                const next = on ? current.filter((x) => x !== p.id) : [...current, p.id];
                updateLane(lane.id, { productFamilies: next }, `${on ? "removed" : "added"} ${p.name}`);
              }} className={cn("rounded-md border px-2 py-0.5 text-[11px]", on ? "border-primary/40 bg-primary/5 text-primary" : "text-muted-foreground")}>{p.name}</button>
            );
          })}
        </div>
      </div>

      {related.length ? (
        <div>
          <Title>Findings ({related.length})</Title>
          <div className="space-y-1">
            {related.map((f) => (
              <button key={f.id} onClick={() => select({ findingId: f.id })} className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-xs hover:border-primary/50">
                <SeverityBadge severity={f.severity} />
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => { setAgentOpen(true); void sendMessage(`Is the lane ${from?.name} → ${to?.name} expensive or risky, and what alternatives should we consider?`); }}><MessageSquare />Ask agent</Button>
        <Button size="sm" variant="destructive" onClick={() => removeLane(lane.id)}><Trash2 />Remove lane</Button>
      </div>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</div>;
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-background px-2.5 py-2", warn && "border-amber-500/50 bg-amber-500/5")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      {sub ? <div className="truncate text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

