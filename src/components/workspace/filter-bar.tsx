"use client";

import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActive, useWorkspace, type InspectStory, type Overlay } from "@/lib/store";
import { NODE_TYPE_META, type FindingCategory, type NodeType, type Temperature } from "@/lib/domain/types";
import { applyFilters } from "@/lib/filters";
import { INSPECT_STORIES } from "@/lib/visual/story";
import { cn } from "@/lib/utils";

const OVERLAYS: { id: Overlay; label: string; hint: string }[] = [
  { id: "volume", label: "Volume", hint: "Node size = weekly throughput, link width = cases per week" },
  { id: "cost", label: "Cost", hint: "Link width = annual lane cost, node size = annual facility cost" },
  { id: "emissions", label: "Carbon", hint: "Width and size = tonnes CO₂e per year" },
  { id: "confidence", label: "Confidence", hint: "Colour = share of confirmed vs assumed data behind each element" },
  { id: "risk", label: "Risk", hint: "Colour = highest finding severity touching the element" },
];

const CATEGORY_LABEL: Record<FindingCategory, string> = {
  capacity: "Capacity", dependency: "Dependency", inventory: "Inventory", lead_time: "Lead time", reliability: "Reliability", cost: "Cost", efficiency: "Efficiency", service: "Service", geographic: "Geography", food_safety: "Food safety", carbon: "Carbon", data_quality: "Data quality", opportunity: "Opportunity",
};

const CANVAS = new Set(["map", "network", "flows"]);

export function FilterBar() {
  const { model, findings } = useActive();
  const view = useWorkspace((s) => s.view);
  const filters = useWorkspace((s) => s.filters);
  const setFilters = useWorkspace((s) => s.setFilters);
  const overlay = useWorkspace((s) => s.overlay);
  const setOverlay = useWorkspace((s) => s.setOverlay);
  if (!model) return null;
  const vis = applyFilters(model, findings, filters);
  const presentTypes = [...new Set(model.nodes.map((n) => n.type))] as NodeType[];
  const anyFilter = vis.active;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b bg-card/60 px-3 scrollbar-thin">
      {CANVAS.has(view) ? (
        <ToggleGroup type="single" size="sm" variant="outline" value={overlay} onValueChange={(v) => v && setOverlay(v as Overlay)} className="shrink-0">
          {OVERLAYS.map((o) => (
            <ToggleGroupItem key={o.id} value={o.id} title={o.hint} className="h-7 px-2 text-xs">
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Filter className="size-3.5" />Filters</span>
      )}
      {CANVAS.has(view) ? (
        <FilterSelect
          value={filters.inspectStory}
          onChange={(v) => setFilters({ inspectStory: v as InspectStory })}
          placeholder="Inspect"
          items={INSPECT_STORIES.map((s) => ({ v: s.id, l: s.label }))}
          highlight={filters.inspectStory !== "volume"}
        />
      ) : null}
      <div className="mx-1 h-5 w-px shrink-0 bg-border" />
      <FilterSelect value={filters.productFamily ?? "all"} onChange={(v) => setFilters({ productFamily: v === "all" ? null : v })} placeholder="All products" items={[{ v: "all", l: "All products" }, ...model.productFamilies.map((p) => ({ v: p.id, l: p.name }))]} />
      <FilterSelect value={filters.temperature ?? "all"} onChange={(v) => setFilters({ temperature: v === "all" ? null : (v as Temperature) })} placeholder="Any temperature" items={[{ v: "all", l: "Any temperature" }, { v: "ambient", l: "Ambient" }, { v: "chilled", l: "Chilled" }, { v: "frozen", l: "Frozen" }]} />
      {model.regions.length ? <FilterSelect value={filters.region ?? "all"} onChange={(v) => setFilters({ region: v === "all" ? null : v })} placeholder="All regions" items={[{ v: "all", l: "All regions" }, ...model.regions.map((r) => ({ v: r.id, l: r.name }))]} /> : null}
      <FilterSelect value={filters.channel} onChange={(v) => setFilters({ channel: v as typeof filters.channel })} placeholder="All channels" items={[{ v: "all", l: "All channels" }, { v: "retail", l: "Retail / B2B" }, { v: "ecom", l: "E-commerce" }, { v: "wholesale", l: "Wholesale" }]} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-7 shrink-0 text-xs", filters.nodeTypes.length && "border-primary/50 bg-primary/5 text-primary")}>
            {filters.nodeTypes.length ? `${filters.nodeTypes.length} node types` : "Node types"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Show node types</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {presentTypes.map((t) => (
            <DropdownMenuCheckboxItem key={t} checked={filters.nodeTypes.includes(t)} onCheckedChange={(c) => setFilters({ nodeTypes: c ? [...filters.nodeTypes, t] : filters.nodeTypes.filter((x) => x !== t) })}>
              <span className="mr-2 inline-block size-2 rounded-full" style={{ background: NODE_TYPE_META[t].color }} />
              {NODE_TYPE_META[t].label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <FilterSelect value={filters.riskCategory ?? "all"} onChange={(v) => setFilters({ riskCategory: v === "all" ? null : (v as FindingCategory) })} placeholder="All risk categories" items={[{ v: "all", l: "All risk categories" }, ...(Object.keys(CATEGORY_LABEL) as FindingCategory[]).filter((c) => findings.some((f) => f.category === c)).map((c) => ({ v: c, l: CATEGORY_LABEL[c] }))]} />
      <ToggleGroup type="single" size="sm" variant="outline" value={filters.horizon} onValueChange={(v) => v && setFilters({ horizon: v as "average" | "peak" })} className="shrink-0">
        <ToggleGroupItem value="average" className="h-7 px-2 text-xs">Average week</ToggleGroupItem>
        <ToggleGroupItem value="peak" className="h-7 px-2 text-xs data-[state=on]:border-rose-500/40 data-[state=on]:bg-rose-500/10 data-[state=on]:text-rose-700 dark:data-[state=on]:text-rose-300">Peak week</ToggleGroupItem>
      </ToggleGroup>
      <div className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[11px] text-muted-foreground">
        {anyFilter ? (
          <>
            <span>{vis.nodeIds.size}/{model.nodes.length} nodes · {vis.laneIds.size}/{model.lanes.length} lanes</span>
            <Button variant="ghost" size="xs" onClick={() => setFilters({ productFamily: null, temperature: null, region: null, nodeTypes: [], riskCategory: null, channel: "all" })}><X />Clear</Button>
          </>
        ) : (
          <span>{model.nodes.length} nodes · {model.lanes.length} lanes</span>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, items, placeholder, highlight }: { value: string; onChange: (v: string) => void; items: { v: string; l: string }[]; placeholder: string; highlight?: boolean }) {
  const active = highlight ?? (value !== "all" && value !== "average");
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={cn("h-7 shrink-0 text-xs", active && "border-primary/50 bg-primary/5 text-primary")}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((it) => (
          <SelectItem key={it.v} value={it.v} className="text-xs">{it.l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
