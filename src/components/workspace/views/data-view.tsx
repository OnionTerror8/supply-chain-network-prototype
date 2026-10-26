"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Braces, FileSpreadsheet, Lock, Plug, Upload, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProvenanceBadge, ProvenanceLegend, TaggedValue } from "@/components/shared/badges";
import { TaggedCell } from "@/components/shared/tagged-field";
import { SectionTitle } from "@/components/shared/kpi";
import { useActive, useWorkspace } from "@/lib/store";
import { COST_COMPONENT_LABEL, NODE_TYPE_META, type Provenance, type Tagged } from "@/lib/domain/types";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/domain/helpers";
import { COST_LOGIC } from "@/lib/engine/metrics";
import { downloadTemplate } from "@/lib/export/excel";
import { importNetworkFile } from "@/lib/export/import";
import { downloadNetworkJson } from "@/lib/export/json";
import { CONNECTORS, PERMISSIONS, AUTOMATION_HOOKS } from "@/lib/integrations/connectors";
import { applyFilters } from "@/lib/filters";
import { cn } from "@/lib/utils";

const CADENCE: Record<string, string> = { batch_daily: "Daily batch", near_real_time: "Near real-time", on_demand: "On demand" };

export function DataView() {
  const { model, metrics, findings, isScenario } = useActive();
  const toggleRule = useWorkspace((s) => s.toggleRule);
  const select = useWorkspace((s) => s.select);
  const updateNode = useWorkspace((s) => s.updateNode);
  const updateLane = useWorkspace((s) => s.updateLane);
  const loadModel = useWorkspace((s) => s.loadModel);
  const setView = useWorkspace((s) => s.setView);
  const filters = useWorkspace((s) => s.filters);
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  if (!model) return null;
  const vis = applyFilters(model, findings, filters);
  const cur = model.currency;
  const name = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;

  const onImport = async (file: File) => {
    try {
      const { model: m, warnings } = await importNetworkFile(file);
      loadModel(m, `Imported “${file.name}”`);
      setView("overview");
      toast.success(`Imported ${m.nodes.length} nodes and ${m.lanes.length} lanes`, { description: warnings[0] });
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 pb-24 md:p-6 md:pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Data, assumptions & integrations</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every value is labelled by provenance. Click a number to overwrite it — that marks it as user-entered. {isScenario ? "You are in a scenario — edits append as scenario changes." : "You are editing the baseline; every change is logged."}
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" size="sm" onClick={() => downloadTemplate()}><FileSpreadsheet />Template</Button>
          <Button variant="outline" size="sm" onClick={() => downloadNetworkJson(model)}><Braces />JSON</Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload />Import</Button>
        </div>
      </div>
      <ProvenanceLegend />

      <Tabs defaultValue="nodes">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="nodes">Nodes ({model.nodes.length})</TabsTrigger>
          <TabsTrigger value="lanes">Lanes ({model.lanes.length})</TabsTrigger>
          <TabsTrigger value="products">Products ({model.productFamilies.length})</TabsTrigger>
          <TabsTrigger value="assumptions">Assumptions & rules</TabsTrigger>
          <TabsTrigger value="cost">Cost logic</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="nodes" className="mt-3">
          <Search value={q} onChange={setQ} placeholder="Filter nodes…" />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Capacity / wk</TableHead>
                  <TableHead className="text-right">Utilisation</TableHead>
                  <TableHead className="text-right">Inv. days</TableHead>
                  <TableHead className="text-right">Fixed / yr</TableHead>
                  <TableHead className="text-right">Handling / case</TableHead>
                  <TableHead className="text-right">Reliability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.nodes.filter((n) => matches(n.name + n.type + (n.location.city ?? ""), q) && vis.nodeIds.has(n.id)).map((n) => {
                  const nm = metrics?.nodeMetrics[n.id];
                  return (
                    <TableRow key={n.id} className="cursor-pointer" onClick={() => select({ nodeId: n.id })}>
                      <TableCell className="font-medium">{n.name}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs"><span className="size-2 rounded-full" style={{ background: NODE_TYPE_META[n.type].color }} />{NODE_TYPE_META[n.type].short}</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <TaggedValue tagged={{ value: `${n.location.city ?? "—"}, ${n.location.country}`, source: n.location.source }} />
                      </TableCell>
                      <EditableCell tagged={n.capacityPerWeek} format={fmtNum} onChange={(t) => updateNode(n.id, { capacityPerWeek: t }, `capacity set to ${fmtNum(t.value)}/wk`)} />
                      <TableCell className="text-right tabular-nums">{nm?.utilisation !== undefined ? <span className={nm.utilisation >= 0.85 ? "font-semibold text-amber-700 dark:text-amber-400" : ""}>{fmtPct(nm.utilisation)}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <EditableCell tagged={n.inventoryDays} format={(v) => v.toFixed(1)} step={0.5} onChange={(t) => updateNode(n.id, { inventoryDays: t }, `inventory days set to ${t.value}`)} />
                      <EditableCell tagged={n.fixedCostPerYear} format={(v) => fmtMoney(v, cur)} onChange={(t) => updateNode(n.id, { fixedCostPerYear: t }, `fixed cost set to ${fmtMoney(t.value, cur)}`)} />
                      <EditableCell tagged={n.handlingCostPerCase} format={(v) => fmtMoney(v, cur, false)} step={0.01} onChange={(t) => updateNode(n.id, { handlingCostPerCase: t }, `handling cost set to ${fmtMoney(t.value, cur, false)}`)} />
                      <EditableCell tagged={n.reliability} format={(v) => fmtPct(v, 1)} step={0.01} onChange={(t) => updateNode(n.id, { reliability: t }, `reliability set to ${fmtPct(t.value, 1)}`)} />
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Click a number to edit it in place, or click the name to open the inspector. {isScenario ? "Edits append to the active scenario." : "Edits update the baseline and appear in History."}</p>
        </TabsContent>

        <TabsContent value="lanes" className="mt-3">
          <Search value={q} onChange={setQ} placeholder="Filter lanes…" />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Pattern</TableHead>
                  <TableHead className="text-right">Volume / wk</TableHead>
                  <TableHead className="text-right">£ / case</TableHead>
                  <TableHead className="text-right">Annual cost</TableHead>
                  <TableHead className="text-right">Transit</TableHead>
                  <TableHead className="text-right">Reliability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.lanes.filter((l) => vis.laneIds.has(l.id) && matches(`${name(l.from)} ${name(l.to)} ${l.mode}`, q)).map((l) => {
                  const lm = metrics?.laneMetrics[l.id];
                  return (
                    <TableRow key={l.id} className="cursor-pointer" onClick={() => select({ laneId: l.id })}>
                      <TableCell className="text-xs">{name(l.from)}</TableCell>
                      <TableCell className="text-xs">{name(l.to)}</TableCell>
                      <TableCell className="text-xs capitalize">{l.mode}{l.crossesBorder ? " · border" : ""}</TableCell>
                      <TableCell className="text-xs">{l.pattern?.replace("_", " ") ?? "linehaul"}</TableCell>
                      <EditableCell tagged={l.volumePerWeek} format={fmtNum} onChange={(t) => updateLane(l.id, { volumePerWeek: t }, `volume set to ${fmtNum(t.value)}/wk`)} />
                      <EditableCell tagged={l.costPerCase ?? (lm ? { value: lm.costPerCase, source: lm.costSource } : undefined)} format={(v) => fmtMoney(v, cur, false)} step={0.01} onChange={(t) => updateLane(l.id, { costPerCase: t }, `cost per case set to ${fmtMoney(t.value, cur, false)}`)} />
                      <TableCell className="text-right tabular-nums">{lm ? fmtMoney(lm.annualCost, cur) : "—"}</TableCell>
                      <EditableCell tagged={l.transitDays} format={(v) => `${v.toFixed(1)} d`} step={0.5} onChange={(t) => updateLane(l.id, { transitDays: t }, `transit set to ${t.value} days`)} />
                      <EditableCell tagged={l.reliability} format={(v) => fmtPct(v, 1)} step={0.01} onChange={(t) => updateLane(l.id, { reliability: t }, `reliability set to ${fmtPct(t.value, 1)}`)} />
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="products" className="mt-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {model.productFamilies.map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{p.name}</div>
                  <span className="rounded-md border px-1.5 py-0.5 text-[10px] capitalize">{p.temperature} · {p.velocity}</span>
                </div>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <Pair label="Share of volume" tagged={p.shareOfVolume} format={(v) => fmtPct(v)} />
                  <Pair label="Case value" tagged={p.unitValue} format={(v) => fmtMoney(v, cur, false)} />
                  <Pair label="Shelf life" tagged={p.shelfLifeDays} format={(v) => `${v} days`} />
                  <Pair label="Weekly shrink" tagged={p.weeklyShrinkRate} format={(v) => fmtPct(v, 1)} />
                </dl>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="assumptions" className="mt-3 space-y-4">
          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-3 text-sm font-medium">Assumptions ({model.assumptions.length})</div>
            <ul className="divide-y">
              {model.assumptions.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <ProvenanceBadge source={a.source} />
                  <div className="min-w-0 flex-1 text-sm">{a.text}</div>
                  <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase", a.sensitivity === "high" ? "bg-rose-500/12 text-rose-700 dark:text-rose-400" : a.sensitivity === "medium" ? "bg-amber-500/12 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>{a.sensitivity} sensitivity</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-3 text-sm font-medium">Operating rules</div>
            <ul className="divide-y">
              {model.rules.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <Switch checked={r.active} onCheckedChange={() => toggleRule(r.id)} disabled={isScenario} />
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm", !r.active && "text-muted-foreground line-through")}>{r.text}</div>
                    <div className="text-[10px] text-muted-foreground">{r.kind} · created by {r.createdBy}</div>
                  </div>
                </li>
              ))}
            </ul>
            {isScenario ? <p className="px-4 py-2 text-[11px] text-muted-foreground">Switch to the baseline to toggle rules. In a scenario, ask the agent to add a rule.</p> : null}
          </div>
        </TabsContent>

        <TabsContent value="cost" className="mt-3 space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <SectionTitle>Global parameters</SectionTitle>
            <p className="mb-3 text-xs text-muted-foreground">Used wherever a lane or node has no confirmed cost. Changing these in production would be a model-version event; they are shown here so you can inspect the calculation.</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(model.parameters.costPerCaseKm) as (keyof typeof model.parameters.costPerCaseKm)[]).map((m) => (
                <Pair key={m} label={`Transport £/case-km (${m})`} tagged={model.parameters.costPerCaseKm[m]} format={(v) => fmtMoney(v, cur, false)} />
              ))}
              <Pair label="Lane handling / case" tagged={model.parameters.laneHandlingPerCase} format={(v) => fmtMoney(v, cur, false)} />
              <Pair label="Inventory carrying rate" tagged={model.parameters.inventoryCarryingRate} format={(v) => fmtPct(v)} />
              <Pair label="Default case value" tagged={model.parameters.defaultCaseValue} format={(v) => fmtMoney(v, cur, false)} />
              <Pair label="Stock-out cost / case" tagged={model.parameters.stockoutCostPerCase} format={(v) => fmtMoney(v, cur, false)} />
              <Pair label="Carbon shadow price / t" tagged={model.parameters.carbonPricePerTonne} format={(v) => fmtMoney(v, cur, false)} />
              <Pair label="Constrained utilisation" tagged={model.parameters.constrainedUtilisation} format={(v) => fmtPct(v)} />
            </dl>
          </div>
          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-3 text-sm font-medium">How each cost line is calculated</div>
            <ul className="divide-y">
              {metrics?.costLines.map((l) => (
                <li key={l.component} className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_1fr_120px]">
                  <div>
                    <div className="text-sm font-medium">{COST_COMPONENT_LABEL[l.component]}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">{fmtMoney(l.annual, cur)} / yr</div>
                  </div>
                  <p className="text-xs text-muted-foreground">{COST_LOGIC[l.component]}</p>
                  <div className="text-right text-[11px]">
                    <ProvenanceBadge source={(l.evidenceShare >= 0.7 ? "confirmed" : l.evidenceShare >= 0.4 ? "user" : l.evidenceShare > 0 ? "assumed" : "missing") as Provenance} />
                    <div className="mt-1 text-muted-foreground">{Math.round(l.evidenceShare * 100)}% evidenced · {l.confidence}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="integrations" className="mt-3 space-y-4">
          <PlaceholderBanner icon={Plug} title="Connectors are placeholders in this prototype" body="The data model is designed so that ERP, WMS, TMS and telematics feeds populate the same Tagged fields as spreadsheet import, with provenance set to ‘confirmed’. Live connectors return HTTP 501 until they are wired." />
          <div className="grid gap-3 md:grid-cols-2">
            {Object.values(CONNECTORS).map((c) => (
              <div key={c.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{c.name}</div>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]">{c.id === "sheets" ? "Available" : "Not connected"}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
                <div className="mt-2 text-[11px] text-muted-foreground">Populates: {c.populates.join(" · ")} · {CADENCE[c.cadence]}</div>
                {c.id === "sheets" ? (
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => fileRef.current?.click()}><Upload />Import now</Button>
                ) : (
                  <Button size="sm" variant="ghost" className="mt-3" disabled><Lock />Connect (reserved)</Button>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <SectionTitle>Role-based access (reserved)</SectionTitle>
            <p className="mb-3 text-xs text-muted-foreground">This prototype runs as a single planner. Production would enforce the matrix below.</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PERMISSIONS.map((p) => (
                  <TableRow key={p.action}>
                    <TableCell className="font-medium capitalize">{p.action.replace("_", " ")}</TableCell>
                    <TableCell className="text-xs">{p.roles.length ? p.roles.join(", ") : "none — disabled"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <SectionTitle>Automation hooks (recommend only)</SectionTitle>
            <p className="mb-3 text-xs text-muted-foreground">Meridian recommends; it does not execute. Trust, permissions and workflow come first.</p>
            <ul className="space-y-2">
              {AUTOMATION_HOOKS.map((h) => (
                <li key={h.id} className="flex items-start gap-3 rounded-lg border px-3 py-2">
                  <Workflow className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="font-medium">{h.trigger}</div>
                    <div className="text-muted-foreground">Would propose: {h.proposedAction}</div>
                  </div>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase">recommend only</span>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mb-2 h-8 max-w-sm text-xs" />;
}

function EditableCell({
  tagged,
  format,
  step,
  onChange,
}: {
  tagged?: Tagged;
  format: (v: number) => string;
  step?: number;
  onChange: (t: Tagged) => void;
}) {
  return (
    <TableCell className="text-right">
      <TaggedCell tagged={tagged} format={format} step={step} onChange={onChange} />
    </TableCell>
  );
}

function Pair({ label, tagged, format }: { label: string; tagged?: { value: number; source: Provenance; note?: string }; format: (v: number) => string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <TaggedValue tagged={tagged} format={format} />
    </div>
  );
}

function PlaceholderBanner({ icon: Icon, title, body }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed bg-muted/30 px-4 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function matches(hay: string, q: string) {
  return !q.trim() || hay.toLowerCase().includes(q.trim().toLowerCase());
}
