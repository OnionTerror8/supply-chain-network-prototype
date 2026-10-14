"use client";

import { FlaskConical, History, User, Bot, Cog } from "lucide-react";
import { EmptyState } from "@/components/shared/kpi";
import { useWorkspace } from "@/lib/store";
import { fmtMoney } from "@/lib/domain/helpers";
import { describeChange } from "./compare-view";
import { cn } from "@/lib/utils";

const ACTOR: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  user: { icon: User, label: "Planner" },
  agent: { icon: Bot, label: "Agent" },
  system: { icon: Cog, label: "System" },
};

export function HistoryView() {
  const changeLog = useWorkspace((s) => s.changeLog);
  const scenarios = useWorkspace((s) => s.scenarios);
  const results = useWorkspace((s) => s.scenarioResults);
  const baseline = useWorkspace((s) => s.baseline);
  const setActive = useWorkspace((s) => s.setActiveScenario);
  const setView = useWorkspace((s) => s.setView);
  const modelVersion = useWorkspace((s) => s.modelVersion);

  if (!baseline) {
    return <EmptyState icon={History} title="No history yet" body="Load or describe a network to start the audit trail." />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 pb-24 md:p-6 md:pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Model history</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every baseline edit, scenario creation and agent action is attributed. Model version {modelVersion}. The agent never silently modifies the baseline.
          </p>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Scenario versions</h2>
        {scenarios.length ? (
          <div className="space-y-2">
            {scenarios.map((s) => {
              const r = results[s.id];
              return (
                <button key={s.id} onClick={() => { setActive(s.id); setView("compare"); }} className="flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left hover:border-primary/40">
                  <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase">{s.status}</span>
                      <span className="text-[10px] text-muted-foreground">{s.createdBy} · {new Date(s.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{r?.comparison.headline ?? s.description}</p>
                    <ol className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                      {s.changes.map((c, i) => <li key={i}>{i + 1}. {describeChange(c, baseline)}</li>)}
                    </ol>
                  </div>
                  {r ? <span className={cn("text-sm font-semibold tabular-nums", r.comparison.netAnnualDelta < 0 ? "text-emerald-600" : r.comparison.netAnnualDelta > 0 ? "text-rose-600" : "text-muted-foreground")}>{fmtMoney(r.comparison.netAnnualDelta, baseline.currency)}</span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No scenarios have been created yet.</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Audit log ({changeLog.length})</h2>
        {changeLog.length ? (
          <ol className="relative space-y-0 border-l pl-5">
            {changeLog.map((e) => {
              const a = ACTOR[e.actor] ?? ACTOR.system;
              const Icon = a.icon;
              return (
                <li key={e.id} className="relative pb-4">
                  <span className={cn("absolute top-0.5 -left-[27px] grid size-5 place-items-center rounded-full border bg-card", e.scope === "scenario" ? "text-amber-600" : "text-primary")}>
                    <Icon className="size-3" />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs font-medium">{e.summary}</span>
                    <span className="text-[10px] text-muted-foreground">{a.label} · {e.scope}{e.scenarioId ? ` · ${scenarios.find((s) => s.id === e.scenarioId)?.name ?? "scenario"}` : ""} · {new Date(e.at).toLocaleString()}</span>
                  </div>
                  {e.details?.length ? (
                    <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">
                      {e.details.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState icon={History} title="Audit log is empty" body="Actions you and the agent take will appear here." />
        )}
      </section>
    </div>
  );
}

