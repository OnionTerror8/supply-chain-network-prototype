"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NODE_TYPE_META, TIER_LABEL, TIER_ORDER, type NetworkMetrics, type NetworkModel, type NodeType, type Tier, type TransportMode } from "@/lib/domain/types";
import { fmtNum, fmtPct } from "@/lib/domain/helpers";
import { MODE_COLOR, vehicleKind } from "@/lib/visual/mode";
import { MovingVehicle, VehicleDefs } from "@/components/shared/vehicles";
import { cn } from "@/lib/utils";

type Cluster = {
  type: NodeType;
  tier: Tier;
  ids: string[];
  volume: number;
  util?: number;
  constrained: boolean;
  x: number;
  y: number;
};

type Flow = {
  key: string;
  volume: number;
  d: string;
  mode: TransportMode;
};

const H = 300;
const PAD_X = 36;
const CLUSTER_H = 72;

function bezier(x1: number, y1: number, x2: number, y2: number, bow = 0) {
  const dx = Math.max(40, (x2 - x1) * 0.45);
  return `M ${x1} ${y1 + bow} C ${x1 + dx} ${y1 + bow}, ${x2 - dx} ${y2 + bow}, ${x2} ${y2 + bow}`;
}

function modeGroup(mode: TransportMode): TransportMode {
  if (mode === "sea") return "sea";
  if (mode === "rail") return "rail";
  if (mode === "parcel" || mode === "van") return "parcel";
  return "road";
}

export function OverviewSchematic({
  model,
  metrics,
  selectedNodeId,
  onSelectNode,
  onOpenMap,
}: {
  model: NetworkModel;
  metrics: NetworkMetrics;
  selectedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
  onOpenMap: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(640, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { clusters, tiers, flows, maxVol } = useMemo(() => {
    const byType = new Map<NodeType, Omit<Cluster, "x" | "y">>();
    for (const n of model.nodes) {
      if (n.type === "returns_center") continue;
      const nm = metrics.nodeMetrics[n.id];
      const util = n.capacityPerWeek ? nm?.utilisation : undefined;
      const vol = Math.max(nm?.inboundPerWeek ?? 0, nm?.outboundPerWeek ?? 0, 0);
      const constrained = util != null && util >= model.parameters.constrainedUtilisation.value;
      const existing = byType.get(n.type);
      if (existing) {
        existing.ids.push(n.id);
        existing.volume += vol;
        existing.util = util == null ? existing.util : Math.max(existing.util ?? 0, util);
        existing.constrained = existing.constrained || constrained;
      } else {
        byType.set(n.type, {
          type: n.type,
          tier: NODE_TYPE_META[n.type].tier,
          ids: [n.id],
          volume: vol,
          util,
          constrained,
        });
      }
    }
    const raw = [...byType.values()];
    const tiers = TIER_ORDER.filter((t) => raw.some((c) => c.tier === t));
    const colW = (width - PAD_X * 2) / Math.max(1, tiers.length);
    const clusters: Cluster[] = raw.map((c) => {
      const col = raw.filter((x) => x.tier === c.tier);
      const i = col.findIndex((x) => x.type === c.type);
      const x = PAD_X + tiers.indexOf(c.tier) * colW + colW / 2;
      const totalH = col.length * CLUSTER_H;
      const y = (H - totalH) / 2 + CLUSTER_H / 2 + i * CLUSTER_H;
      return { ...c, x, y };
    });
    const pos = new Map(clusters.map((c) => [c.type, c]));
    const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
    const linkMap = new Map<string, { from: NodeType; to: NodeType; mode: TransportMode; volume: number }>();
    for (const l of model.lanes) {
      if (l.pattern === "returns" || l.pattern === "backhaul") continue;
      const a = nodeById.get(l.from);
      const b = nodeById.get(l.to);
      if (!a || !b) continue;
      if (TIER_ORDER.indexOf(NODE_TYPE_META[a.type].tier) >= TIER_ORDER.indexOf(NODE_TYPE_META[b.type].tier)) continue;
      const mode = modeGroup(l.mode);
      const key = `${a.type}→${b.type}→${mode}`;
      const ex = linkMap.get(key);
      if (ex) ex.volume += l.volumePerWeek.value;
      else linkMap.set(key, { from: a.type, to: b.type, mode, volume: l.volumePerWeek.value });
    }
    const pairModes = new Map<string, TransportMode[]>();
    for (const link of linkMap.values()) {
      const pk = `${link.from}→${link.to}`;
      const list = pairModes.get(pk) ?? [];
      list.push(link.mode);
      pairModes.set(pk, list);
    }
    const flows: Flow[] = [];
    for (const [key, link] of linkMap) {
      const a = pos.get(link.from);
      const b = pos.get(link.to);
      if (!a || !b) continue;
      const siblings = pairModes.get(`${link.from}→${link.to}`) ?? [link.mode];
      const i = siblings.indexOf(link.mode);
      const bow = siblings.length > 1 ? (i - (siblings.length - 1) / 2) * 18 : 0;
      flows.push({ key, volume: link.volume, mode: link.mode, d: bezier(a.x + 46, a.y, b.x - 46, b.y, bow) });
    }
    return { clusters, tiers, flows, maxVol: Math.max(1, ...flows.map((f) => f.volume)) };
  }, [model, metrics, width]);

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div>
          <h3 className="font-heading text-sm font-semibold tracking-tight">Live network flow</h3>
          <p className="text-[11px] text-muted-foreground">Ochre trucks on road, teal ships at sea. Pulse = constrained. Click a node type to inspect it on the map.</p>
        </div>
        <button type="button" onClick={onOpenMap} className="text-[11px] font-medium text-primary hover:underline">
          Open map
        </button>
      </div>
      <div ref={wrapRef} className="relative h-[300px] w-full">
        <svg viewBox={`0 0 ${width} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Animated schematic of trucks and ships moving through the supply network">
          <VehicleDefs />
          {tiers.map((tier) => {
            const sample = clusters.find((c) => c.tier === tier);
            if (!sample) return null;
            return (
              <text key={tier} x={sample.x} y={18} textAnchor="middle" fill="currentColor" className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase" style={{ fontSize: 10 }}>
                {TIER_LABEL[tier]}
              </text>
            );
          })}
          {flows.map((f) => {
            const strokeW = 1.6 + (f.volume / maxVol) * 8;
            const color = MODE_COLOR[f.mode];
            const n = f.volume / maxVol > 0.55 ? 2 : 1;
            const kind = vehicleKind(f.mode);
            const dur = kind === "ship" ? 7.5 : 4.2;
            return (
              <g key={f.key}>
                <path d={f.d} fill="none" stroke="var(--border)" strokeWidth={strokeW + 2.4} />
                <path d={f.d} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={strokeW} className="flow-animated" />
                {Array.from({ length: n }, (_, i) => (
                  <MovingVehicle key={i} path={f.d} kind={kind} color={color} dur={`${dur + i * 0.7}s`} delay={`${i * 0.9}s`} />
                ))}
              </g>
            );
          })}
          {clusters.map((c) => {
            const meta = NODE_TYPE_META[c.type];
            const selected = c.ids.includes(selectedNodeId ?? "");
            const r = 22;
            const circ = 2 * Math.PI * (r - 4);
            const util = Math.min(1, c.util ?? 0);
            return (
              <g key={c.type} transform={`translate(${c.x}, ${c.y})`}>
                {c.constrained ? <circle r={r + 8} fill="none" stroke="#9a4a2a" strokeWidth={2} className="pulse-ring" opacity={0.7} /> : null}
                <circle r={r + 2} fill="var(--card)" stroke={selected ? "var(--primary)" : "var(--border)"} strokeWidth={selected ? 2.5 : 1} />
                <circle r={r - 4} fill="none" stroke="var(--muted)" strokeWidth={4} />
                <circle r={r - 4} fill="none" stroke={c.constrained ? "#9a4a2a" : meta.color} strokeWidth={4} strokeDasharray={`${circ * util} ${circ}`} strokeLinecap="round" transform="rotate(-90)" />
                <text textAnchor="middle" y={4} fill="currentColor" className="text-foreground" style={{ fontSize: 11, fontWeight: 600 }}>
                  {c.ids.length}
                </text>
              </g>
            );
          })}
        </svg>
        {clusters.map((c) => {
          const meta = NODE_TYPE_META[c.type];
          return (
            <button
              key={`hit-${c.type}`}
              type="button"
              onClick={() => onSelectNode(c.ids[0])}
              className="absolute z-10 -translate-x-1/2 translate-y-6 rounded-md px-1.5 py-0.5 text-center focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left: `${(c.x / width) * 100}%`, top: `${(c.y / H) * 100}%` }}
              aria-label={`${meta.label}, ${c.ids.length} site${c.ids.length === 1 ? "" : "s"}${c.util != null ? `, ${fmtPct(c.util)} utilised` : ""}`}
            >
              <span className="block text-[11px] font-medium leading-tight">{meta.short}</span>
              <span className={cn("block text-[10px] tabular-nums", c.constrained ? "font-semibold text-[#9a4a2a] dark:text-orange-300" : "text-muted-foreground")}>
                {c.util != null ? fmtPct(c.util) : fmtNum(c.volume)}
                {c.constrained ? " tight" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 px-4 pb-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: MODE_COLOR.road }} />Road / truck</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: MODE_COLOR.sea }} />Sea / ship</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: MODE_COLOR.parcel }} />Parcel / van</span>
      </div>
    </div>
  );
}
