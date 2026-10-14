"use client";

import { ArrowDown, ArrowUp, ChevronRight, FlaskConical, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, SeverityBadge } from "./badges";
import type { Finding, NetworkModel } from "@/lib/domain/types";
import { fmtMoney } from "@/lib/domain/helpers";
import { useWorkspace } from "@/lib/store";
import { cn } from "@/lib/utils";

export const CATEGORY_LABEL: Record<Finding["category"], string> = {
  capacity: "Capacity", dependency: "Dependency", inventory: "Inventory", lead_time: "Lead time", reliability: "Reliability", cost: "Cost", efficiency: "Efficiency", service: "Service", geographic: "Geography", food_safety: "Food safety", carbon: "Carbon", data_quality: "Data quality", opportunity: "Opportunity",
};

export function FindingSummary({ f, model, selected, onClick }: { f: Finding; model: NetworkModel; selected?: boolean; onClick?: () => void }) {
  const impact = f.impact.costAnnual ? fmtMoney(f.impact.costAnnual, model.currency) : f.impact.servicePts ? `${f.impact.servicePts > 0 ? "+" : ""}${f.impact.servicePts.toFixed(1)} pts` : f.impact.riskDelta ? `${f.impact.riskDelta > 0 ? "+" : ""}${f.impact.riskDelta} risk` : null;
  return (
    <button onClick={onClick} className={cn("flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40", selected && "border-primary ring-2 ring-primary/20")}>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={f.severity} />
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{CATEGORY_LABEL[f.category]}</span>
        </div>
        <div className="text-sm font-medium leading-snug">{f.title}</div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{f.detected}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ConfidenceBadge confidence={f.confidence} />
          {impact ? <span className="text-[11px] font-medium tabular-nums">{impact}{f.impact.costAnnual ? "/yr" : ""}</span> : null}
          {f.suggestedScenario ? <span className="inline-flex items-center gap-1 text-[11px] text-primary"><FlaskConical className="size-3" />Scenario available</span> : null}
        </div>
      </div>
      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function FindingDetail({ f, model }: { f: Finding; model: NetworkModel }) {
  const select = useWorkspace((s) => s.select);
  const createScenarioFromChanges = useWorkspace((s) => s.createScenarioFromChanges);
  const sendMessage = useWorkspace((s) => s.sendMessage);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  const names = (ids: string[]) => ids.map((id) => model.nodes.find((n) => n.id === id)).filter(Boolean) as NetworkModel["nodes"];
  const lanes = f.impacted.laneIds.map((id) => model.lanes.find((l) => l.id === id)).filter(Boolean) as NetworkModel["lanes"];
  const nodeName = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={f.severity} />
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{CATEGORY_LABEL[f.category]}</span>
          {f.impacted.period ? <span className="text-[10px] text-muted-foreground">· {f.impacted.period}</span> : null}
        </div>
        <h3 className="text-base font-semibold leading-snug">{f.title}</h3>
        <div className="mt-2"><ConfidenceBadge confidence={f.confidence} size="md" /></div>
      </div>

      <Section title="What was detected">{f.detected}</Section>
      <Section title="Why it matters">{f.whyItMatters}</Section>

      {(f.impact.costAnnual || f.impact.servicePts || f.impact.riskDelta || f.impact.emissionsTonnes) ? (
        <Section title="Estimated impact">
          <div className="grid grid-cols-2 gap-2">
            {f.impact.costAnnual ? <Impact label="Annual cost" value={`${fmtMoney(f.impact.costAnnual, model.currency)}/yr`} /> : null}
            {f.impact.servicePts ? <Impact label="Service" value={`${f.impact.servicePts > 0 ? "+" : ""}${f.impact.servicePts.toFixed(1)} pts`} /> : null}
            {f.impact.riskDelta ? <Impact label="Risk score" value={`${f.impact.riskDelta > 0 ? "+" : ""}${f.impact.riskDelta}`} /> : null}
            {f.impact.emissionsTonnes ? <Impact label="Emissions" value={`${Math.round(f.impact.emissionsTonnes)} tCO₂e`} /> : null}
          </div>
        </Section>
      ) : null}

      {(names(f.impacted.nodeIds).length || lanes.length) ? (
        <Section title="Impacted elements">
          <div className="flex flex-wrap gap-1.5">
            {names(f.impacted.nodeIds).map((n) => (
              <button key={n.id} onClick={() => select({ nodeId: n.id })} className="rounded-md border bg-background px-2 py-0.5 text-xs hover:border-primary/50">{n.name}</button>
            ))}
            {lanes.map((l) => (
              <button key={l.id} onClick={() => select({ laneId: l.id })} className="rounded-md border bg-background px-2 py-0.5 text-xs hover:border-primary/50">{nodeName(l.from)} → {nodeName(l.to)}</button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Recommended actions">
        <ol className="list-decimal space-y-1 pl-4 text-xs">
          {f.actions.map((a, i) => <li key={i}>{a}</li>)}
        </ol>
      </Section>
      {f.tradeOffs.length ? (
        <Section title="Trade-offs">
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{f.tradeOffs.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </Section>
      ) : null}
      <Section title="Data used">
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{f.dataUsed.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </Section>
      {f.assumptions.length ? (
        <Section title="Assumptions">
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{f.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </Section>
      ) : null}
      <Section title="Confidence drivers">
        <ul className="space-y-1 text-xs">
          {f.confidenceDrivers.map((d, i) => (
            <li key={i} className="flex items-start gap-1.5">
              {d.effect === "up" ? <ArrowUp className="mt-0.5 size-3 shrink-0 text-emerald-600" /> : <ArrowDown className="mt-0.5 size-3 shrink-0 text-rose-600" />}
              <span>{d.driver}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Executive summary">
        <p className="rounded-lg border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-xs">{f.executiveSummary}</p>
      </Section>
      <div className="flex flex-wrap gap-2 pt-1">
        {f.suggestedScenario ? (
          <Button size="sm" onClick={() => createScenarioFromChanges(f.suggestedScenario!.name, f.suggestedScenario!.description, f.suggestedScenario!.changes)}>
            <FlaskConical />Model suggested scenario
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => { setAgentOpen(true); void sendMessage(`Tell me more about: ${f.title}. What should we do and what data would raise confidence?`); }}>
          <MessageSquare />Ask the agent
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</div>
      <div className="text-xs leading-relaxed">{children}</div>
    </div>
  );
}

function Impact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
