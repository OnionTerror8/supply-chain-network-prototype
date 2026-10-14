"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sankey, sankeyLinkHorizontal, sankeyJustify, type SankeyNode, type SankeyLink } from "d3-sankey";
import { Switch } from "@/components/ui/switch";
import { useActive, useWorkspace } from "@/lib/store";
import { NODE_TYPE_META, TIER_ORDER, type NetworkNode, type NodeType } from "@/lib/domain/types";
import { fmtMoney, fmtNum } from "@/lib/domain/helpers";
import { applyFilters, laneVisual, severityIndex } from "@/lib/filters";
import { cn } from "@/lib/utils";

type SNode = { id: string; name: string; type: NodeType; nodeIds: string[]; color: string };
type SLink = { source: string; target: string; value: number; laneIds: string[]; color: string };
type LaidNode = SankeyNode<SNode, SLink>;
type LaidLink = SankeyLink<SNode, SLink>;

const SUB_RANK: Partial<Record<NodeType, number>> = { store: 0, customer_zone: 2, wholesaler: 0, ecom_fc: 0, micro_fc: 1, dark_store: 1, returns_center: 3, cross_dock: 1 };
const rank = (t: NodeType) => TIER_ORDER.indexOf(NODE_TYPE_META[t].tier) * 10 + (SUB_RANK[t] ?? 0);

export function FlowsView() {
  const { model, metrics, findings } = useActive();
  const overlay = useWorkspace((s) => s.overlay);
  const filters = useWorkspace((s) => s.filters);
  const selection = useWorkspace((s) => s.selection);
  const select = useWorkspace((s) => s.select);
  const setHover = useWorkspace((s) => s.setHover);
  const [group, setGroup] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [hover, setLocalHover] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vis = useMemo(() => (model ? applyFilters(model, findings, filters) : null), [model, findings, filters]);
  const sev = useMemo(() => severityIndex(findings), [findings]);

  const { graph, hidden } = useMemo(() => {
    if (!model) return { graph: null, hidden: 0 };
    const customerTypes = new Set<NodeType>(["customer_zone", "store"]);
    const customerCount = model.nodes.filter((n) => customerTypes.has(n.type)).length;
    const grouping = group && customerCount > 8;
    const regionOf = new Map<string, string>();
    for (const r of model.regions) for (const id of r.nodeIds) regionOf.set(id, r.id);
    const keyFor = (n: NetworkNode) => (grouping && customerTypes.has(n.type) ? `grp:${n.type}:${regionOf.get(n.id) ?? "other"}` : n.id);
    const sNodes = new Map<string, SNode>();
    for (const n of model.nodes) {
      if (vis && !vis.nodeIds.has(n.id)) continue;
      const k = keyFor(n);
      const existing = sNodes.get(k);
      if (existing) existing.nodeIds.push(n.id);
      else sNodes.set(k, { id: k, name: k.startsWith("grp:") ? `${model.regions.find((r) => r.id === regionOf.get(n.id))?.name ?? "Other"} ${n.type === "store" ? "stores" : "customers"}` : n.name, type: n.type, nodeIds: [n.id], color: NODE_TYPE_META[n.type].color });
    }
    const links = new Map<string, SLink>();
    let hidden = 0;
    const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
    for (const l of model.lanes) {
      if (vis && !vis.laneIds.has(l.id)) continue;
      const a = nodeById.get(l.from);
      const b = nodeById.get(l.to);
      if (!a || !b) continue;
      if (l.pattern === "returns" || l.pattern === "backhaul" || rank(a.type) >= rank(b.type)) {
        hidden++;
        continue;
      }
      const v = laneVisual(overlay === "risk" || overlay === "confidence" ? "volume" : overlay, l, metrics, sev.lanes[l.id]);
      if (v.value <= 0) continue;
      const k = `${keyFor(a)}→${keyFor(b)}`;
      const ex = links.get(k);
      if (ex) {
        ex.value += v.value;
        ex.laneIds.push(l.id);
      } else links.set(k, { source: keyFor(a), target: keyFor(b), value: v.value, laneIds: [l.id], color: laneVisual(overlay, l, metrics, sev.lanes[l.id]).color });
    }
    const used = new Set([...links.values()].flatMap((l) => [l.source, l.target]));
    const nodesArr = [...sNodes.values()].filter((n) => used.has(n.id));
    if (!nodesArr.length) return { graph: null, hidden };
    try {
      const layout = sankey<SNode, SLink>().nodeId((d) => d.id).nodeWidth(14).nodePadding(10).nodeAlign(sankeyJustify).extent([[16, 24], [size.w - 16, size.h - 40]]);
      const graph = layout({ nodes: nodesArr.map((n) => ({ ...n })), links: [...links.values()].map((l) => ({ ...l })) });
      return { graph, hidden };
    } catch {
      return { graph: null, hidden };
    }
  }, [model, metrics, vis, overlay, group, size, sev]);

  if (!model) return null;
  const cur = model.currency;
  const unit = overlay === "cost" ? (v: number) => `${fmtMoney(v, cur)}/yr` : overlay === "emissions" ? (v: number) => `${fmtNum(v)} t CO₂e` : (v: number) => `${fmtNum(v)} cases/wk`;
  const linkPath = sankeyLinkHorizontal<SNode, SLink>();
  const isLinkActive = (l: LaidLink) => hover === `l:${l.index}` || (!!selection?.laneId && l.laneIds.includes(selection.laneId)) || (!!selection?.nodeId && ((l.source as LaidNode).nodeIds.includes(selection.nodeId) || (l.target as LaidNode).nodeIds.includes(selection.nodeId)));
  const isNodeActive = (n: LaidNode) => hover === `n:${n.id}` || (!!selection?.nodeId && n.nodeIds.includes(selection.nodeId));
  const anySelection = !!(selection?.nodeId || selection?.laneId) || !!hover;

  return (
    <div ref={wrapRef} className="relative h-full w-full bg-background">
      {graph ? (
        <svg width={size.w} height={size.h} className="block">
          <g>
            {(graph.links as LaidLink[]).map((l) => {
              const active = isLinkActive(l);
              return (
                <path key={l.index} d={linkPath(l) ?? undefined} fill="none" stroke={active ? "var(--foreground)" : l.color} strokeOpacity={active ? 0.75 : anySelection ? 0.12 : 0.35} strokeWidth={Math.max(1, l.width ?? 1)} className="cursor-pointer transition-[stroke-opacity]" onMouseEnter={() => { setLocalHover(`l:${l.index}`); if (l.laneIds.length === 1) setHover(l.laneIds[0]); }} onMouseLeave={() => { setLocalHover(null); setHover(null); }} onClick={() => select(l.laneIds.length === 1 ? { laneId: l.laneIds[0] } : { nodeId: (l.source as LaidNode).nodeIds[0] })}>
                  <title>{(l.source as LaidNode).name} → {(l.target as LaidNode).name}: {unit(l.value)}{l.laneIds.length > 1 ? ` (${l.laneIds.length} lanes)` : ""}</title>
                </path>
              );
            })}
          </g>
          <g>
            {(graph.nodes as LaidNode[]).map((n) => {
              const active = isNodeActive(n);
              const x0 = n.x0 ?? 0, x1 = n.x1 ?? 0, y0 = n.y0 ?? 0, y1 = n.y1 ?? 0;
              const right = x0 > size.w / 2;
              const worst = n.nodeIds.map((id) => sev.nodes[id]).find(Boolean);
              return (
                <g key={n.id} className="cursor-pointer" onMouseEnter={() => { setLocalHover(`n:${n.id}`); if (n.nodeIds.length === 1) setHover(n.nodeIds[0]); }} onMouseLeave={() => { setLocalHover(null); setHover(null); }} onClick={() => select({ nodeId: n.nodeIds[0] })}>
                  <rect x={x0} y={y0} width={x1 - x0} height={Math.max(2, y1 - y0)} fill={n.color} rx={3} stroke={active ? "var(--foreground)" : worst ? "#dc2626" : "none"} strokeWidth={active ? 2 : 1.5} opacity={anySelection && !active ? 0.5 : 1} />
                  <text x={right ? x0 - 6 : x1 + 6} y={(y0 + y1) / 2} dy="0.35em" textAnchor={right ? "end" : "start"} fontSize={11} className={cn("fill-foreground", active && "font-semibold")} style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}>
                    {n.name}
                    <tspan className="fill-muted-foreground" fontSize={9}> {unit(n.value ?? 0)}</tspan>
                  </text>
                  <title>{n.name}: {unit(n.value ?? 0)}{n.nodeIds.length > 1 ? ` (${n.nodeIds.length} nodes)` : ""}</title>
                </g>
              );
            })}
          </g>
        </svg>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No forward flows match the current filters.</div>
      )}
      <div className="absolute top-3 right-3 flex items-center gap-2 rounded-lg border bg-card/90 px-2.5 py-1.5 text-[11px] backdrop-blur">
        <span className="text-muted-foreground">Group customers by region</span>
        <Switch checked={group} onCheckedChange={setGroup} />
      </div>
      <div className="absolute bottom-3 left-3 rounded-lg border bg-card/90 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
        Flow width = {overlay === "cost" ? "annual lane cost" : overlay === "emissions" ? "annual emissions" : "cases per week"} · left → right follows the tier order
        {hidden ? ` · ${hidden} lateral / returns / backhaul lane${hidden === 1 ? "" : "s"} not drawn` : ""}
        {" · "}red outline = node with an open finding
      </div>
    </div>
  );
}
