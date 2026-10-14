"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/store";
import { TopBar } from "./top-bar";
import { NavRail } from "./nav-rail";
import { FilterBar } from "./filter-bar";
import { AgentPanel } from "./agent-panel";
import { InspectorPanel } from "./inspector-panel";
import { Onboarding } from "./onboarding";
import { OverviewView } from "./views/overview-view";
import { MapView } from "./views/map-view";
import { NetworkView } from "./views/network-view";
import { FlowsView } from "./views/flows-view";
import { CompareView } from "./views/compare-view";
import { FindingsView } from "./views/findings-view";
import { DataView } from "./views/data-view";
import { LibraryView } from "./views/library-view";
import { HistoryView } from "./views/history-view";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const CANVAS_VIEWS = new Set(["map", "network", "flows"]);

export function Workspace() {
  const [ready, setReady] = useState(false);
  const baseline = useWorkspace((s) => s.baseline);
  const view = useWorkspace((s) => s.view);
  const agentOpen = useWorkspace((s) => s.agentOpen);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  const inspectorOpen = useWorkspace((s) => s.inspectorOpen);

  useEffect(() => {
    try {
      void useWorkspace.persist?.rehydrate?.();
    } catch {
      /* localStorage may be unavailable; the workspace still opens. */
    }
    const t = window.setTimeout(() => {
      useWorkspace.getState().setHydrated();
      setReady(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          Loading workspace
        </div>
      </div>
    );
  }

  const showOnboarding = !baseline && view !== "library";
  const canvas = CANVAS_VIEWS.has(view);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="relative flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
          {!showOnboarding && baseline ? <FilterBar /> : null}
          <div className={cn("relative min-h-0 flex-1", canvas ? "overflow-hidden" : "overflow-y-auto scrollbar-thin")}>
            {showOnboarding ? (
              <Onboarding />
            ) : (
              <>
                {view === "overview" && <OverviewView />}
                {view === "map" && <MapView />}
                {view === "network" && <NetworkView />}
                {view === "flows" && <FlowsView />}
                {view === "compare" && <CompareView />}
                {view === "findings" && <FindingsView />}
                {view === "data" && <DataView />}
                {view === "library" && <LibraryView />}
                {view === "history" && <HistoryView />}
              </>
            )}
            {inspectorOpen && baseline ? <InspectorPanel /> : null}
          </div>
        </main>
        <aside className={cn("hidden shrink-0 border-l bg-card lg:flex", agentOpen ? "w-[380px] xl:w-[420px]" : "w-0 overflow-hidden border-l-0")}>
          {agentOpen ? <AgentPanel /> : null}
        </aside>
      </div>
      <div className="lg:hidden">
        <Sheet open={agentOpen} onOpenChange={setAgentOpen}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-md">
            <SheetTitle className="sr-only">Planning agent</SheetTitle>
            <AgentPanel />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
