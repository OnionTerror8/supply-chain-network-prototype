"use client";

import { useTheme } from "next-themes";
import { useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Bot, ChevronDown, Download, FileSpreadsheet, FolderOpen, Moon, Plus, Sun, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfidenceBadge } from "@/components/shared/badges";
import { useActive, useWorkspace } from "@/lib/store";
import { importNetworkFile } from "@/lib/export/import";
import { downloadTemplate } from "@/lib/export/excel";
import { downloadNetworkJson } from "@/lib/export/json";
import { buildCanonicalSample } from "@/lib/data/canonical-sample";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/domain/helpers";

export function TopBar() {
  const { baseline, metrics, scenario, isScenario, result } = useActive();
  const scenarios = useWorkspace((s) => s.scenarios);
  const setActiveScenario = useWorkspace((s) => s.setActiveScenario);
  const agentOpen = useWorkspace((s) => s.agentOpen);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  const exportExcel = useWorkspace((s) => s.exportExcel);
  const loadSample = useWorkspace((s) => s.loadSample);
  const loadModel = useWorkspace((s) => s.loadModel);
  const resetWorkspace = useWorkspace((s) => s.resetWorkspace);
  const setView = useWorkspace((s) => s.setView);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    try {
      const { model, warnings } = await importNetworkFile(file);
      loadModel(model, `Imported “${file.name}”`);
      setView("overview");
      toast.success(`Imported ${model.nodes.length} nodes and ${model.lanes.length} lanes`, { description: warnings[0] });
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
      <div className="flex items-center gap-2 pr-2">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
            <path d="M12 2.2 14.1 9.9 21.8 12 14.1 14.1 12 21.8 9.9 14.1 2.2 12 9.9 9.9Z" />
          </svg>
        </span>
        <div className="leading-none">
          <div className="font-heading text-sm font-semibold tracking-tight">Meridian</div>
          <div className="hidden text-[10px] text-muted-foreground sm:block">Network modelling</div>
        </div>
      </div>
      <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
      {baseline ? (
        <>
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <span className="truncate text-sm font-medium">{baseline.name}</span>
            {metrics ? <span className="hidden text-xs text-muted-foreground xl:inline">{fmtMoney(metrics.totalAnnualCost, baseline.currency)} operating · {Math.round(metrics.serviceLevel * 100)}% service</span> : null}
          </div>
          <Select value={scenario?.id ?? "baseline"} onValueChange={(v) => setActiveScenario(v === "baseline" ? null : v)}>
            <SelectTrigger size="sm" className={cn("ml-1 max-w-56 border-dashed", isScenario ? "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "border-primary/40 bg-primary/5 text-primary")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="baseline">
                <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-primary" />Baseline</span>
              </SelectItem>
              {scenarios.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-amber-500" />{s.name}<span className="text-[10px] text-muted-foreground uppercase">{s.status}</span></span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {metrics ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden sm:inline-flex"><ConfidenceBadge confidence={metrics.dataConfidence} /></span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72 text-xs">
                {Math.round(metrics.confidenceScore * 100)}% of the model is backed by confirmed or user-entered data. {isScenario && result ? result.comparison.confidenceNote : "Replace assumed values in the Data view to raise confidence."}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </>
      ) : (
        <span className="text-sm text-muted-foreground">No network loaded</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm"><FolderOpen />Open<ChevronDown className="opacity-60" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Sample networks</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => loadSample("canonical")}>Canonical starter (10-node JSON shape)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => loadSample("food")}>Food manufacturer (chilled & ambient)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => loadSample("retail")}>Omnichannel retailer (stores & e-com)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => downloadNetworkJson(buildCanonicalSample(), "meridian-canonical-starter.json")}>Download canonical JSON</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileRef.current?.click()}><Upload />Import spreadsheet</DropdownMenuItem>
            <DropdownMenuItem onClick={() => downloadTemplate()}><FileSpreadsheet />Download import template</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { resetWorkspace(); toast("Workspace cleared"); }}><Plus />New blank workspace</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" disabled={!baseline} onClick={() => { exportExcel(); toast.success("Workbook exported", { description: isScenario ? "Includes the active scenario comparison" : "Baseline, findings, assumptions and change log" }); }}>
              <Download /><span className="hidden sm:inline">Export</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export to Excel (baseline, scenario comparison, findings, assumptions, audit log)</TooltipContent>
        </Tooltip>
        <ThemeToggle />
        <Button variant={agentOpen ? "secondary" : "ghost"} size="sm" onClick={() => setAgentOpen(!agentOpen)} aria-pressed={agentOpen}>
          <Bot /><span className="hidden sm:inline">Agent</span>
        </Button>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
