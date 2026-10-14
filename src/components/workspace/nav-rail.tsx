"use client";

import { AlertTriangle, BookOpen, Database, GitCompareArrows, History, LayoutDashboard, Map as MapIcon, Network, Waves } from "lucide-react";
import type { WorkspaceView } from "@/lib/agent/types";
import { useActive, useWorkspace } from "@/lib/store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ITEMS: { id: WorkspaceView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "map", label: "Map", icon: MapIcon },
  { id: "network", label: "Network", icon: Network },
  { id: "flows", label: "Flows", icon: Waves },
  { id: "findings", label: "Findings", icon: AlertTriangle },
  { id: "compare", label: "Compare", icon: GitCompareArrows },
  { id: "data", label: "Data", icon: Database },
  { id: "library", label: "Library", icon: BookOpen },
  { id: "history", label: "History", icon: History },
];

export function NavRail() {
  const view = useWorkspace((s) => s.view);
  const setView = useWorkspace((s) => s.setView);
  const scenarios = useWorkspace((s) => s.scenarios);
  const { findings } = useActive();
  const critical = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;

  const badge = (id: WorkspaceView) => (id === "findings" && critical ? critical : id === "compare" && scenarios.length ? scenarios.length : 0);

  return (
    <>
      <nav className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r bg-card py-2 md:flex">
        {ITEMS.map((it) => {
          const active = view === it.id;
          const b = badge(it.id);
          return (
            <Tooltip key={it.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setView(it.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn("relative flex size-10 flex-col items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}
                >
                  <it.icon className="size-[18px]" />
                  {b ? <span className={cn("absolute top-1 right-1 grid min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold text-white", it.id === "findings" ? "bg-rose-600" : "bg-amber-500")}>{b}</span> : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{it.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-1 overflow-x-auto border-t bg-card px-2 py-1 md:hidden">
        {ITEMS.map((it) => (
          <button key={it.id} onClick={() => setView(it.id)} className={cn("flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 py-1 text-[10px] text-muted-foreground", view === it.id && "bg-primary/10 text-primary")}>
            <it.icon className="size-4" />
            {it.label}
          </button>
        ))}
      </nav>
    </>
  );
}
