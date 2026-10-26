"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, BookOpen, Compass, FileSpreadsheet, GitBranch, Snowflake, Store, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/store";
import { importNetworkFile } from "@/lib/export/import";
import { downloadTemplate } from "@/lib/export/excel";
import { downloadNetworkJson } from "@/lib/export/json";
import { buildCanonicalSample } from "@/lib/data/canonical-sample";
import { ProvenanceLegend } from "@/components/shared/badges";

const EXAMPLE = "We buy raw material from five suppliers, receive it into two factories, send finished goods via a national DC to regional DCs, then to stores. Some e-commerce orders ship from the national DC. We have significant seasonal demand and cold-chain requirements.";

export function Onboarding() {
  const sendMessage = useWorkspace((s) => s.sendMessage);
  const loadSample = useWorkspace((s) => s.loadSample);
  const loadModel = useWorkspace((s) => s.loadModel);
  const setView = useWorkspace((s) => s.setView);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  const agentBusy = useWorkspace((s) => s.agentBusy);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const describe = () => {
    const t = text.trim() || EXAMPLE;
    setAgentOpen(true);
    void sendMessage(`Build my current network from this description: ${t}`);
  };

  const onImport = async (file: File) => {
    try {
      const { model, warnings } = await importNetworkFile(file);
      loadModel(model, `Imported “${file.name}”`);
      toast.success(`Imported ${model.nodes.length} nodes and ${model.lanes.length} lanes`, { description: warnings[0] });
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10 pb-24 md:pb-10">
      <div className="max-w-2xl">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <Compass className="size-3 text-primary" /> From harbour to last mile
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Describe your supply chain. Get a baseline you can interrogate.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Meridian turns a plain-language description, a spreadsheet, or a library template into a connected network model from first receipt to last mile. It flags pinchpoints, exposes every assumption, and lets you test alternatives against the baseline before anyone commits.
        </p>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-xs">
        <label className="mb-2 block text-xs font-medium text-muted-foreground">Describe your network in your own words</label>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} rows={4} className="resize-none text-sm" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) describe(); }} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">The agent asks only the highest-value follow-ups (locations, goals), then builds the baseline with every estimate labelled.</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setText(EXAMPLE)}>Use example</Button>
            <Button size="sm" onClick={describe} disabled={agentBusy}>Build baseline<ArrowRight /></Button>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Or start from</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StartCard icon={Snowflake} title="Food manufacturer sample" body="Two factories, chilled and ambient ranges, national DC feeding four regional DCs, imported produce via Dover, cold-chain and shelf-life constraints." cta="Load sample" onClick={() => loadSample("food")} accent="#1f3d4d" />
          <StartCard icon={Store} title="Omnichannel retailer sample" body="Store replenishment through an NDC, a dedicated e-commerce FC, ship-from-store vans, marketplace drop-ship and a returns centre." cta="Load sample" onClick={() => loadSample("retail")} accent="#c2782a" />
          <StartCard icon={Upload} title="Import a spreadsheet" body="Upload nodes, lanes and product families using the Meridian template. Imported values are marked as confirmed data." cta="Choose file" onClick={() => fileRef.current?.click()} secondary={<Button variant="link" size="xs" className="px-0" onClick={() => downloadTemplate()}><FileSpreadsheet />Download template</Button>} accent="#0f6f73" />
          <StartCard icon={BookOpen} title="Use a distribution model" body="Instantiate a governed template: central or regional, cross-docking, milk runs, backhauls, DSD, DTC and more." cta="Open library" onClick={() => setView("library")} accent="#9a4a2a" />
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-3">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <GitBranch className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Canonical 10-node starter</div>
            <p className="text-xs text-muted-foreground">The intended JSON shape: tagged numbers, origin-to-customer lanes, goals, rules and assumptions beside the graph.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => loadSample("canonical")}>Load starter</Button>
          <Button size="sm" variant="ghost" onClick={() => downloadNetworkJson(buildCanonicalSample(), "meridian-canonical-starter.json")}>Download JSON</Button>
        </div>
      </div>

      <div className="rounded-xl border border-dashed p-4">
        <div className="mb-2 text-xs font-medium">How Meridian treats data</div>
        <p className="mb-2 text-xs text-muted-foreground">Every number carries its provenance. Assumed and AI-derived values are never presented as facts, and confidence is computed from the share of confirmed evidence behind each result.</p>
        <ProvenanceLegend />
      </div>
    </div>
  );
}

function StartCard({ icon: Icon, title, body, cta, onClick, secondary, accent }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string; cta: string; onClick: () => void; secondary?: React.ReactNode; accent: string }) {
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md">
      <span className="mb-3 grid size-8 place-items-center rounded-lg" style={{ background: `color-mix(in oklch, ${accent} 12%, transparent)`, color: accent }}>
        <Icon className="size-4" />
      </span>
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 flex-1 text-xs text-muted-foreground">{body}</p>
      <div className="mt-3 flex items-center justify-between">
        <Button size="sm" variant="outline" onClick={onClick}>{cta}</Button>
        {secondary}
      </div>
    </div>
  );
}
