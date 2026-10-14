"use client";

import { useState } from "react";
import { BookOpen, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/kpi";
import { useWorkspace } from "@/lib/store";
import { DISTRIBUTION_MODELS, MODEL_CATEGORY_LABEL, type DistributionModel } from "@/lib/library/models";
import { NODE_TYPE_META } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const CATS = ["all", ...(Object.keys(MODEL_CATEGORY_LABEL) as DistributionModel["category"][])] as const;

export function LibraryView() {
  const sendMessage = useWorkspace((s) => s.sendMessage);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  const setView = useWorkspace((s) => s.setView);
  const baseline = useWorkspace((s) => s.baseline);
  const [cat, setCat] = useState<(typeof CATS)[number]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const list = DISTRIBUTION_MODELS.filter((m) => cat === "all" || m.category === cat).sort((a, b) => Number(b.priority) - Number(a.priority) || a.name.localeCompare(b.name));

  const instantiate = (m: DistributionModel) => {
    setAgentOpen(true);
    if (!baseline) setView("overview");
    void sendMessage(m.example);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-24 md:p-6 md:pb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Distribution model library</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Governed, extensible templates. Each model carries default assumptions, node types, lane types, cost components, service patterns, risks and optimisation rules. Instantiating a model asks the agent to build a baseline from it — nothing is applied silently.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cn("rounded-full border px-2.5 py-1 text-[11px]", cat === c ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>
            {c === "all" ? `All (${DISTRIBUTION_MODELS.length})` : `${MODEL_CATEGORY_LABEL[c as DistributionModel["category"]]} (${DISTRIBUTION_MODELS.filter((m) => m.category === c).length})`}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((m) => (
            <article key={m.id} className={cn("flex flex-col rounded-xl border bg-card p-4 shadow-xs", open === m.id && "ring-2 ring-primary/20")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="text-sm font-semibold">{m.name}</h2>
                    {m.priority ? <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"><Star className="size-2.5" />Priority</span> : null}
                    <Badge variant="outline" className="text-[10px]">{MODEL_CATEGORY_LABEL[m.category]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{m.summary}</p>
                </div>
              </div>
              <p className="mt-2 text-xs"><span className="font-medium">When to use: </span>{m.whenToUse}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {m.nodeTypes.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]">
                    <span className="size-1.5 rounded-full" style={{ background: NODE_TYPE_META[t].color }} />
                    {NODE_TYPE_META[t].short}
                  </span>
                ))}
              </div>
              {open === m.id ? (
                <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                  <Block title="Lane types" items={m.laneTypes} />
                  <Block title="Cost components" items={m.costComponents} />
                  <div><div className="mb-0.5 font-medium">Service pattern</div><p className="text-muted-foreground">{m.servicePattern}</p></div>
                  <Block title="Risks" items={m.risks} />
                  <Block title="Optimisation rules" items={m.optimisationRules} />
                  <div>
                    <div className="mb-0.5 font-medium">Default assumptions (editable)</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {m.defaultAssumptions.map((a, i) => <li key={i}>{a.text}{a.editable ? "" : " (locked)"}</li>)}
                    </ul>
                  </div>
                  <p className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] italic">Example prompt: “{m.example}”</p>
                </div>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={() => instantiate(m)}><Sparkles />Use this model</Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? "Hide details" : "Details"}</Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={BookOpen} title="No models in this category" />
      )}
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-0.5 font-medium">{title}</div>
      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  );
}
