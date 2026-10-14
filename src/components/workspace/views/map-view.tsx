"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { Locate, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActive, useWorkspace } from "@/lib/store";
import { NODE_TYPE_META, type Lane, type NetworkNode } from "@/lib/domain/types";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/domain/helpers";
import { applyFilters, laneVisual, nodeVisual, severityIndex, sqrtScale } from "@/lib/filters";
import { cn } from "@/lib/utils";

type Transform = { k: number; x: number; y: number };
type Land = { type: "FeatureCollection"; features: GeoPermissibleObjects[] };

export function MapView() {
  const { model, metrics, findings, baseline, isScenario } = useActive();
  const overlay = useWorkspace((s) => s.overlay);
  const filters = useWorkspace((s) => s.filters);
  const selection = useWorkspace((s) => s.selection);
  const select = useWorkspace((s) => s.select);
  const hoverId = useWorkspace((s) => s.hoverId);
  const setHover = useWorkspace((s) => s.setHover);
  const moveNode = useWorkspace((s) => s.moveNode);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [land, setLand] = useState<Land | null>(null);
  const [t, setT] = useState<Transform>({ k: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState<{ kind: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; pos?: [number, number] } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; node?: NetworkNode; lane?: Lane } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    import("world-atlas/countries-50m.json").then((mod) => {
      const topo = (mod.default ?? mod) as unknown as Topology<{ countries: GeometryCollection }>;
      const fc = feature(topo, topo.objects.countries) as unknown as Land;
      if (alive) setLand(fc);
    });
    return () => {
      alive = false;
    };
  }, []);

  const projection = useMemo(() => {
    const nodes = model?.nodes ?? [];
    const lats = nodes.map((n) => n.location.lat);
    const lngs = nodes.map((n) => n.location.lng);
    const pad = 0.6;
    const minLat = (lats.length ? Math.min(...lats) : 49) - pad;
    const maxLat = (lats.length ? Math.max(...lats) : 59) + pad;
    const minLng = (lngs.length ? Math.min(...lngs) : -8) - pad;
    const maxLng = (lngs.length ? Math.max(...lngs) : 2) + pad;
    const box: GeoPermissibleObjects = { type: "Polygon", coordinates: [[[minLng, minLat], [minLng, maxLat], [maxLng, maxLat], [maxLng, minLat], [minLng, minLat]]] };
    return geoMercator().fitExtent([[40, 40], [size.w - 40, size.h - 40]], box);
  }, [model, size]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const landPath = useMemo(() => (land ? path(land as unknown as GeoPermissibleObjects) ?? "" : ""), [land, path]);

  const vis = useMemo(() => (model ? applyFilters(model, findings, filters) : null), [model, findings, filters]);
  const sev = useMemo(() => severityIndex(findings), [findings]);
  const baselineNodeIds = useMemo(() => new Set(baseline?.nodes.map((n) => n.id) ?? []), [baseline]);
  const baselineLaneIds = useMemo(() => new Set(baseline?.lanes.map((l) => l.id) ?? []), [baseline]);
  const modelNodeIds = useMemo(() => new Set(model?.nodes.map((n) => n.id) ?? []), [model]);
  const peak = useMemo(() => (filters.horizon === "peak" ? Math.max(1, ...(model?.regions.map((r) => r.seasonalityPeakFactor?.value ?? 1) ?? [1])) : 1), [filters.horizon, model]);

  const laneScale = useMemo(() => sqrtScale(model?.lanes.map((l) => laneVisual(overlay, l, metrics).value) ?? [], 1, 14), [model, overlay, metrics]);
  const nodeScale = useMemo(() => sqrtScale(model?.nodes.map((n) => nodeVisual(overlay, n, metrics).value) ?? [], 5, 22), [model, overlay, metrics]);

  const project = useCallback((n: NetworkNode): [number, number] => {
    if (drag?.kind === "node" && drag.id === n.id && drag.pos) return drag.pos;
    return projection([n.location.lng, n.location.lat]) ?? [0, 0];
  }, [projection, drag]);

  const toLocal = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const { x, y } = toLocal(e as unknown as React.PointerEvent);
    const factor = Math.exp(-e.deltaY * 0.0015);
    setT((p) => {
      const k = Math.min(40, Math.max(0.5, p.k * factor));
      const ratio = k / p.k;
      return { k, x: x - (x - p.x) * ratio, y: y - (y - p.y) * ratio };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = toLocal(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ kind: "pan", sx: x, sy: y, ox: t.x, oy: t.y, moved: false });
  };
  const onNodePointerDown = (e: React.PointerEvent, n: NetworkNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { x, y } = toLocal(e);
    (wrapRef.current?.querySelector("svg") as Element | null)?.setPointerCapture(e.pointerId);
    setDrag({ kind: "node", id: n.id, sx: x, sy: y, ox: 0, oy: 0, moved: false, pos: project(n) });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = toLocal(e);
    if (!drag) {
      if (tip) setTip((p) => (p ? { ...p, x, y } : p));
      return;
    }
    const dx = x - drag.sx;
    const dy = y - drag.sy;
    const moved = drag.moved || Math.hypot(dx, dy) > 3;
    if (drag.kind === "pan") {
      setT((p) => ({ ...p, x: drag.ox + dx, y: drag.oy + dy }));
      setDrag({ ...drag, moved });
    } else {
      setDrag({ ...drag, moved, pos: [(x - t.x) / t.k, (y - t.y) / t.k] });
    }
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === "node" && drag.id) {
      if (drag.moved && drag.pos) {
        const ll = projection.invert?.(drag.pos);
        if (ll) moveNode(drag.id, ll[1], ll[0]);
      } else {
        select({ nodeId: drag.id });
      }
    } else if (!drag.moved) {
      select(null);
    }
    setDrag(null);
  };

  const reset = () => setT({ k: 1, x: 0, y: 0 });
  const zoomBy = (f: number) => setT((p) => {
    const k = Math.min(40, Math.max(0.5, p.k * f));
    const cx = size.w / 2;
    const cy = size.h / 2;
    const ratio = k / p.k;
    return { k, x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio };
  });

  if (!model) return null;
  const cur = model.currency;
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const removedNodes = isScenario && baseline ? baseline.nodes.filter((n) => !modelNodeIds.has(n.id)) : [];
  const removedLanes = isScenario && baseline ? baseline.lanes.filter((l) => !model.lanes.some((x) => x.id === l.id) && baseline.nodes.some((n) => n.id === l.from) && baseline.nodes.some((n) => n.id === l.to)) : [];
  const baseNodeById = new Map(baseline?.nodes.map((n) => [n.id, n]) ?? []);
  const isActive = (nodeId?: string, laneId?: string) => (nodeId && (selection?.nodeId === nodeId || hoverId === nodeId)) || (laneId && (selection?.laneId === laneId || hoverId === laneId));
  const typesPresent = [...new Set(model.nodes.map((n) => n.type))];

  const lanePath = (a: [number, number], b: [number, number]) => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const off = Math.min(40, len * 0.18);
    return `M${a[0]},${a[1]} Q${mx - (dy / len) * off},${my + (dx / len) * off} ${b[0]},${b[1]}`;
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none select-none overflow-hidden bg-[#eef2f7] dark:bg-[#0b1220]">
      <svg width={size.w} height={size.h} className={cn("block", drag?.kind === "pan" ? "cursor-grabbing" : "cursor-grab")} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { setTip(null); setHover(null); }}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          <path d={landPath} className="fill-white stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-700" vectorEffect="non-scaling-stroke" strokeWidth={0.8} />

          {removedLanes.map((l) => {
            const a = baseNodeById.get(l.from);
            const b = baseNodeById.get(l.to);
            if (!a || !b) return null;
            return <path key={l.id} d={lanePath(projection([a.location.lng, a.location.lat]) ?? [0, 0], projection([b.location.lng, b.location.lat]) ?? [0, 0])} fill="none" stroke="#dc2626" strokeDasharray={`${4 / t.k} ${4 / t.k}`} strokeWidth={1.2 / t.k} opacity={0.5} />;
          })}

          {model.lanes.map((l) => {
            const a = nodeById.get(l.from);
            const b = nodeById.get(l.to);
            if (!a || !b) return null;
            const v = laneVisual(overlay, l, metrics, sev.lanes[l.id]);
            const dim = vis && !vis.laneIds.has(l.id);
            const active = isActive(undefined, l.id);
            const connected = selection?.nodeId && (l.from === selection.nodeId || l.to === selection.nodeId);
            const w = laneScale(v.value * (overlay === "volume" ? peak : 1)) / t.k;
            const added = isScenario && !baselineLaneIds.has(l.id);
            return (
              <g key={l.id} opacity={dim ? 0.08 : active || connected ? 1 : selection?.nodeId || selection?.laneId ? 0.35 : 0.8}>
                <path d={lanePath(project(a), project(b))} fill="none" stroke="transparent" strokeWidth={Math.max(w, 10 / t.k)} className="cursor-pointer" onPointerEnter={(e) => { setHover(l.id); setTip({ ...toLocal(e), lane: l }); }} onPointerLeave={() => { setHover(null); setTip(null); }} onPointerDown={(e) => { e.stopPropagation(); select({ laneId: l.id }); }} />
                <path d={lanePath(project(a), project(b))} fill="none" stroke={active ? "#111827" : added ? "#059669" : v.color} strokeWidth={active ? w + 1.5 / t.k : w} strokeLinecap="round" strokeDasharray={added || l.pattern === "milk_run" || l.pattern === "backhaul" || l.pattern === "returns" ? `${6 / t.k} ${4 / t.k}` : undefined} className={cn("pointer-events-none dark:stroke-opacity-90", active && "dark:[stroke:#f8fafc]")} />
              </g>
            );
          })}

          {removedNodes.map((n) => {
            const p = projection([n.location.lng, n.location.lat]) ?? [0, 0];
            return (
              <g key={n.id} transform={`translate(${p[0]},${p[1]})`} className="cursor-pointer" onPointerDown={(e) => { e.stopPropagation(); select({ nodeId: n.id }); }}>
                <circle r={8 / t.k} fill="none" stroke="#dc2626" strokeWidth={1.5 / t.k} strokeDasharray={`${3 / t.k} ${2 / t.k}`} />
                <line x1={-4 / t.k} y1={-4 / t.k} x2={4 / t.k} y2={4 / t.k} stroke="#dc2626" strokeWidth={1.5 / t.k} />
                <line x1={4 / t.k} y1={-4 / t.k} x2={-4 / t.k} y2={4 / t.k} stroke="#dc2626" strokeWidth={1.5 / t.k} />
              </g>
            );
          })}

          {[...model.nodes].sort((a, b) => nodeVisual(overlay, b, metrics).value - nodeVisual(overlay, a, metrics).value).map((n) => {
            const v = nodeVisual(overlay, n, metrics, sev.nodes[n.id]);
            const p = project(n);
            const r = nodeScale(v.value) / t.k;
            const dim = vis && !vis.nodeIds.has(n.id);
            const active = isActive(n.id);
            const added = isScenario && !baselineNodeIds.has(n.id);
            const isCustomer = n.type === "customer_zone" || n.type === "store";
            const showLabel = !isCustomer || t.k > 2.2 || active;
            return (
              <g key={n.id} transform={`translate(${p[0]},${p[1]})`} opacity={dim ? 0.12 : 1} className="cursor-pointer" onPointerDown={(e) => onNodePointerDown(e, n)} onPointerEnter={(e) => { setHover(n.id); setTip({ ...toLocal(e), node: n }); }} onPointerLeave={() => { setHover(null); setTip(null); }}>
                {active ? <circle r={r + 6 / t.k} fill={v.color} opacity={0.25} filter="url(#glow)" /> : null}
                {v.ring ? <circle r={r + 3 / t.k} fill="none" stroke={v.ring} strokeWidth={2 / t.k} className="pulse-ring" /> : null}
                {added ? <circle r={r + 4 / t.k} fill="none" stroke="#059669" strokeWidth={1.5 / t.k} strokeDasharray={`${3 / t.k} ${2 / t.k}`} /> : null}
                <circle r={r} fill={v.color} stroke={active ? "#111827" : "#fff"} strokeWidth={(active ? 2 : 1.2) / t.k} className={cn(isCustomer && overlay !== "risk" && overlay !== "confidence" && "fill-opacity-70", active && "dark:[stroke:#f8fafc]")} />
                {n.location.source !== "confirmed" && n.location.source !== "user" ? <circle r={r} fill="none" stroke="#fff" strokeWidth={1 / t.k} strokeDasharray={`${2 / t.k} ${2 / t.k}`} opacity={0.9} /> : null}
                {showLabel ? (
                  <text x={r + 4 / t.k} y={3.5 / t.k} fontSize={11 / t.k} className="pointer-events-none fill-slate-800 dark:fill-slate-100" style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 / t.k, fontWeight: isCustomer ? 400 : 600 }}>{n.name}</text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {tip ? (
        <div className="pointer-events-none absolute z-10 max-w-64 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg" style={{ left: Math.min(tip.x + 14, size.w - 260), top: Math.min(tip.y + 14, size.h - 120) }}>
          {tip.node ? <NodeTip n={tip.node} /> : tip.lane ? <LaneTip l={tip.lane} /> : null}
        </div>
      ) : null}

      <div className="absolute top-3 left-3 flex max-w-[60%] flex-wrap gap-1 rounded-lg border bg-card/90 p-2 text-[10px] backdrop-blur">
        {typesPresent.map((ty) => (
          <span key={ty} className="inline-flex items-center gap-1 rounded px-1 py-0.5"><span className="size-2 rounded-full" style={{ background: NODE_TYPE_META[ty].color }} />{NODE_TYPE_META[ty].short}</span>
        ))}
      </div>
      <div className="absolute bottom-3 left-3 rounded-lg border bg-card/90 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
        {overlay === "volume" && <>Size = throughput · width = cases/week{peak > 1 ? ` (peak ×${peak.toFixed(2)})` : ""} · dashed = milk run / backhaul / returns</>}
        {overlay === "cost" && <>Width = annual lane cost · size = annual facility cost</>}
        {overlay === "emissions" && <>Width & size = tCO₂e per year</>}
        {overlay === "confidence" && <>Green confirmed → blue user → amber assumed → purple AI-estimated → grey missing</>}
        {overlay === "risk" && <>Colour = highest finding severity (red critical → blue low); grey = none</>}
        {isScenario ? <> · <span className="text-emerald-600">green dashed = added</span> · <span className="text-rose-600">red = removed</span></> : null}
        {" · "}drag a node to move it, scroll to zoom
      </div>
      <div className="absolute right-3 bottom-3 flex flex-col gap-1">
        <Button size="icon-sm" variant="outline" onClick={() => zoomBy(1.4)} aria-label="Zoom in"><Plus /></Button>
        <Button size="icon-sm" variant="outline" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out"><Minus /></Button>
        <Button size="icon-sm" variant="outline" onClick={reset} aria-label="Reset view"><Locate /></Button>
      </div>
    </div>
  );

  function NodeTip({ n }: { n: NetworkNode }) {
    const nm = metrics?.nodeMetrics[n.id];
    return (
      <>
        <div className="font-medium">{n.name}</div>
        <div className="text-muted-foreground">{NODE_TYPE_META[n.type].label} · {n.temperature}</div>
        {nm ? <div className="mt-1 grid grid-cols-2 gap-x-3 tabular-nums"><span>{fmtNum(nm.throughputPerWeek)} cases/wk</span><span>{nm.utilisation !== undefined ? `${fmtPct(nm.utilisation)} util.` : "no capacity"}</span><span>{fmtMoney(nm.annualCost, cur)}/yr</span><span>{Math.round(nm.emissionsTonnes)} t CO₂e</span></div> : null}
        {sev.nodes[n.id] ? <div className="mt-1 capitalize text-rose-600">{sev.nodes[n.id]} finding</div> : null}
      </>
    );
  }
  function LaneTip({ l }: { l: Lane }) {
    const lm = metrics?.laneMetrics[l.id];
    return (
      <>
        <div className="font-medium">{nodeById.get(l.from)?.name} → {nodeById.get(l.to)?.name}</div>
        <div className="text-muted-foreground">{l.mode} · {l.temperature}{l.pattern ? ` · ${l.pattern.replace("_", " ")}` : ""}</div>
        <div className="mt-1 grid grid-cols-2 gap-x-3 tabular-nums"><span>{fmtNum(l.volumePerWeek.value)} cases/wk</span>{lm ? <><span>{fmtMoney(lm.costPerCase, cur, false)}/case ({lm.costSource})</span><span>{fmtMoney(lm.annualCost, cur)}/yr</span><span>{Math.round(lm.distanceKm)} km · {lm.transitDays.toFixed(1)} d</span></> : null}</div>
      </>
    );
  }
}
