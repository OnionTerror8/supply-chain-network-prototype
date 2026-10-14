"use client";

import { useCallback, useMemo, useState } from "react";
import { Background, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, MarkerType, Position, ReactFlow, type Connection, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActive, useWorkspace, quickNode } from "@/lib/store";
import { NODE_TYPE_META, TIER_LABEL, TIER_ORDER, type Lane, type NetworkNode, type NodeType, type Severity } from "@/lib/domain/types";
import { fmtMoney, fmtNum, fmtPct, uid } from "@/lib/domain/helpers";
import { applyFilters, laneVisual, nodeVisual, severityIndex, sqrtScale, SEVERITY_HEX } from "@/lib/filters";
import { cn } from "@/lib/utils";

type FlowNodeData = { node: NetworkNode; color: string; ring?: string; utilisation?: number; throughput: number; annualCost: number; currency: string; dim: boolean; added: boolean; severity?: Severity; selected: boolean; evidence: string };
type FlowEdgeData = { lane: Lane; width: number; color: string; dim: boolean; added: boolean; label: string; active: boolean; dashed: boolean };

const COL_W = 260;
const ROW_H = 92;

function NetNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { node, color, utilisation, throughput, annualCost, currency, dim, added, severity, selected, ring } = data;
  const meta = NODE_TYPE_META[node.type];
  return (
    <div className={cn("w-[200px] rounded-xl border bg-card shadow-xs transition-opacity", dim && "opacity-15", selected && "ring-2 ring-primary", added && "border-dashed border-emerald-500")} style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-slate-400" />
      <div className="flex items-start gap-2 px-2.5 pt-2">
        <span className="mt-0.5 rounded px-1 py-0.5 text-[9px] font-bold text-white" style={{ background: color }}>{meta.short}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold leading-tight">{node.name}</div>
          <div className="truncate text-[10px] text-muted-foreground">{node.location.city ?? meta.label} · {node.temperature}</div>
        </div>
        {severity ? <span className="size-2 shrink-0 rounded-full" style={{ background: SEVERITY_HEX[severity] }} title={`${severity} finding`} /> : null}
      </div>
      <div className="flex items-center justify-between px-2.5 pb-2 pt-1 text-[10px] tabular-nums text-muted-foreground">
        <span>{fmtNum(throughput)}/wk</span>
        <span>{fmtMoney(annualCost, currency)}/yr</span>
        {utilisation !== undefined ? <span className={cn("font-medium", utilisation >= 0.95 ? "text-rose-600" : utilisation >= 0.85 ? "text-amber-600" : "text-foreground")}>{fmtPct(utilisation)}</span> : <span className="italic">no cap.</span>}
      </div>
      {utilisation !== undefined ? (
        <div className="mx-2.5 mb-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, utilisation * 100)}%`, background: ring ?? color }} />
        </div>
      ) : null}
      <div className="mx-2.5 mb-1.5 text-[9px] text-muted-foreground">{data.evidence}</div>
    </div>
  );
}

function NetEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<Edge<FlowEdgeData>>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  if (!data) return null;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: data.active ? "var(--foreground)" : data.added ? "#059669" : data.color, strokeWidth: data.active ? data.width + 1.5 : data.width, opacity: data.dim ? 0.08 : data.active ? 1 : 0.7, strokeDasharray: data.dashed || data.added ? "6 4" : undefined }} className={data.added ? "flow-animated" : undefined} />
      {data.active ? (
        <EdgeLabelRenderer>
          <div className="pointer-events-none absolute rounded-md border bg-popover px-1.5 py-0.5 text-[10px] shadow" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>{data.label}</div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { net: NetNode };
const edgeTypes = { net: NetEdge };

export function NetworkView() {
  const { model, metrics, findings, baseline, isScenario } = useActive();
  const overlay = useWorkspace((s) => s.overlay);
  const filters = useWorkspace((s) => s.filters);
  const selection = useWorkspace((s) => s.selection);
  const hoverId = useWorkspace((s) => s.hoverId);
  const select = useWorkspace((s) => s.select);
  const setHover = useWorkspace((s) => s.setHover);
  const addLane = useWorkspace((s) => s.addLane);
  const addNode = useWorkspace((s) => s.addNode);
  const modelVersion = useWorkspace((s) => s.modelVersion);
  const [posBag, setPosBag] = useState<{ id?: string; map: Record<string, { x: number; y: number }> }>({ map: {} });
  const positions = useMemo(() => (posBag.id === model?.id ? posBag.map : {}), [posBag, model?.id]);

  const vis = useMemo(() => (model ? applyFilters(model, findings, filters) : null), [model, findings, filters]);
  const sev = useMemo(() => severityIndex(findings), [findings]);
  const baselineNodeIds = useMemo(() => new Set(baseline?.nodes.map((n) => n.id) ?? []), [baseline]);
  const baselineLaneIds = useMemo(() => new Set(baseline?.lanes.map((l) => l.id) ?? []), [baseline]);

  const { nodes, edges, columns } = useMemo(() => {
    if (!model) return { nodes: [] as Node<FlowNodeData>[], edges: [] as Edge<FlowEdgeData>[], columns: [] as { tier: string; x: number; count: number }[] };
    const tiers = TIER_ORDER.filter((t) => model.nodes.some((n) => NODE_TYPE_META[n.type].tier === t));
    const laneScale = sqrtScale(model.lanes.map((l) => laneVisual(overlay, l, metrics).value), 1, 9);
    const columns: { tier: string; x: number; count: number }[] = [];
    const nodes: Node<FlowNodeData>[] = [];
    const maxRows = Math.max(...tiers.map((t) => model.nodes.filter((n) => NODE_TYPE_META[n.type].tier === t).length));
    tiers.forEach((tier, ci) => {
      const inTier = model.nodes.filter((n) => NODE_TYPE_META[n.type].tier === tier).sort((a, b) => b.location.lat - a.location.lat || a.name.localeCompare(b.name));
      const offsetY = ((maxRows - inTier.length) * ROW_H) / 2;
      columns.push({ tier, x: ci * COL_W, count: inTier.length });
      inTier.forEach((n, ri) => {
        const v = nodeVisual(overlay, n, metrics, sev.nodes[n.id]);
        const nm = metrics?.nodeMetrics[n.id];
        const fields = [n.capacityPerWeek, n.inventoryDays, n.fixedCostPerYear, n.handlingCostPerCase, n.reliability];
        const conf = fields.filter((f) => f && (f.source === "confirmed" || f.source === "user")).length;
        nodes.push({
          id: n.id,
          type: "net",
          position: positions[n.id] ?? { x: ci * COL_W, y: 40 + offsetY + ri * ROW_H },
          data: { node: n, color: v.color, ring: v.ring, utilisation: nm?.utilisation, throughput: nm?.throughputPerWeek ?? 0, annualCost: nm?.annualCost ?? 0, currency: model.currency, dim: !!vis && !vis.nodeIds.has(n.id), added: isScenario && !baselineNodeIds.has(n.id), severity: sev.nodes[n.id], selected: selection?.nodeId === n.id, evidence: `${conf}/${fields.length} fields confirmed` },
          draggable: true,
        });
      });
    });
    const edges: Edge<FlowEdgeData>[] = model.lanes.map((l) => {
      const v = laneVisual(overlay, l, metrics, sev.lanes[l.id]);
      const lm = metrics?.laneMetrics[l.id];
      const active = selection?.laneId === l.id || hoverId === l.id || (!!selection?.nodeId && (l.from === selection.nodeId || l.to === selection.nodeId));
      return {
        id: l.id,
        source: l.from,
        target: l.to,
        type: "net",
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: active ? "var(--foreground)" : v.color },
        data: { lane: l, width: laneScale(v.value), color: v.color, dim: !!vis && !vis.laneIds.has(l.id), added: isScenario && !baselineLaneIds.has(l.id), label: `${fmtNum(l.volumePerWeek.value)}/wk · ${lm ? fmtMoney(lm.costPerCase, model.currency, false) : "?"}/case · ${lm ? fmtMoney(lm.annualCost, model.currency) : ""}`, active, dashed: l.pattern === "milk_run" || l.pattern === "backhaul" || l.pattern === "returns" },
        zIndex: active ? 10 : 0,
      };
    });
    return { nodes, edges, columns };
  }, [model, metrics, overlay, vis, sev, selection, hoverId, isScenario, baselineNodeIds, baselineLaneIds, positions]);

  const onConnect = useCallback((c: Connection) => {
    if (!model || !c.source || !c.target || c.source === c.target) return;
    const from = model.nodes.find((n) => n.id === c.source);
    const to = model.nodes.find((n) => n.id === c.target);
    if (!from || !to) return;
    const outbound = model.lanes.filter((l) => l.from === from.id).reduce((a, l) => a + l.volumePerWeek.value, 0);
    const lane: Lane = {
      id: uid("lane"),
      from: from.id,
      to: to.id,
      mode: "road",
      temperature: to.temperature === "multi" ? from.temperature : to.temperature,
      productFamilies: [],
      volumePerWeek: { value: Math.max(100, Math.round(outbound * 0.1 / 100) * 100), source: "assumed", note: "Placeholder: 10% of origin outbound. Edit in the inspector." },
    };
    addLane(lane);
    select({ laneId: lane.id });
    toast("Lane added with placeholder volume", { description: "Set the real volume and rate in the inspector; cost is estimated from distance until then." });
  }, [model, addLane, select]);

  const addQuick = (type: NodeType) => {
    if (!model) return;
    const ref = model.nodes.find((n) => n.type === "national_dc") ?? model.nodes[0];
    const node = quickNode(type, `New ${NODE_TYPE_META[type].label}`, (ref?.location.lat ?? 52.5) + 0.3, (ref?.location.lng ?? -1.5) - 0.3, type === "cold_store" ? "chilled" : "ambient");
    addNode(node);
    select({ nodeId: node.id });
    toast.success(`${NODE_TYPE_META[type].label} added`, { description: "Drag it on the map to place it, then connect lanes here." });
  };

  if (!model) return null;

  return (
    <div className="relative h-full w-full" key={`${model.id}-${modelVersion}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        onNodeClick={(_, n) => select({ nodeId: n.id })}
        onEdgeClick={(_, e) => select({ laneId: e.id })}
        onNodeMouseEnter={(_, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
        onEdgeMouseEnter={(_, e) => setHover(e.id)}
        onEdgeMouseLeave={() => setHover(null)}
        onPaneClick={() => select(null)}
        onNodeDragStop={(_, n) => setPosBag((p) => ({ id: model.id, map: { ...(p.id === model.id ? p.map : {}), [n.id]: n.position } }))}
        onConnect={onConnect}
        className="bg-background"
      >
        <Background gap={24} size={1} className="!bg-background" />
        <Controls showInteractive={false} className="!rounded-lg !border !bg-card !shadow-xs [&>button]:!border-b [&>button]:!bg-card [&>button]:!fill-foreground" />
      </ReactFlow>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-0 px-3 pt-2">
        {columns.map((c) => (
          <div key={c.tier} className="w-[260px] shrink-0 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{TIER_LABEL[c.tier as keyof typeof TIER_LABEL]} <span className="font-normal">({c.count})</span></div>
        ))}
      </div>
      <div className="absolute top-2 right-3 flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Plus />Add node</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel>Add to {isScenario ? "scenario" : "baseline"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(NODE_TYPE_META) as NodeType[]).map((t) => (
              <DropdownMenuItem key={t} onClick={() => addQuick(t)}><span className="mr-1 size-2 rounded-full" style={{ background: NODE_TYPE_META[t].color }} />{NODE_TYPE_META[t].label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="absolute bottom-3 left-3 rounded-lg border bg-card/90 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
        Tiers run left → right. Drag from a node’s right handle to another node to add a lane. Click any element to inspect and edit.
      </div>
    </div>
  );
}
