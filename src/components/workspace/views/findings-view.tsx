"use client";

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/kpi";
import { CATEGORY_LABEL, FindingSummary } from "@/components/shared/finding-card";
import { useActive, useWorkspace } from "@/lib/store";
import type { Finding, Severity } from "@/lib/domain/types";
import { SEVERITY_COLOR } from "@/components/shared/badges";
import { cn } from "@/lib/utils";

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export function FindingsView() {
  const { model, findings, isScenario, scenario } = useActive();
  const select = useWorkspace((s) => s.select);
  const selection = useWorkspace((s) => s.selection);
  const [category, setCategory] = useState<Finding["category"] | "all">("all");
  const [severity, setSeverity] = useState<Severity | "all">("all");

  const categories = useMemo(() => (Object.keys(CATEGORY_LABEL) as Finding["category"][]).filter((c) => findings.some((f) => f.category === c)), [findings]);
  const list = useMemo(() => findings.filter((f) => (category === "all" || f.category === category) && (severity === "all" || f.severity === severity)).sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)), [findings, category, severity]);
  if (!model) return null;

  const counts = SEV_ORDER.map((s) => ({ s, n: findings.filter((f) => f.severity === s).length }));

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-24 md:p-6 md:pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pinchpoints, risks & opportunities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isScenario ? `Detected in scenario “${scenario?.name}”. ` : "Detected in the baseline. "}
            Every finding shows the evidence used, the assumptions made and what drives its confidence.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {counts.map(({ s, n }) => (
            <button key={s} onClick={() => setSeverity(severity === s ? "all" : s)} className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs capitalize", severity === s && "ring-2 ring-primary/30")} style={{ color: SEVERITY_COLOR[s] }}>
              <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
              {n} {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip active={category === "all"} onClick={() => setCategory("all")}>All ({findings.length})</Chip>
        {categories.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{CATEGORY_LABEL[c]} ({findings.filter((f) => f.category === c).length})</Chip>
        ))}
      </div>

      {list.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {list.map((f) => <FindingSummary key={f.id} f={f} model={model} selected={selection?.findingId === f.id} onClick={() => select({ findingId: f.id })} />)}
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title="Nothing to show" body="No findings match the current filters." />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("rounded-full border px-2.5 py-1 text-[11px] transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>{children}</button>
  );
}
