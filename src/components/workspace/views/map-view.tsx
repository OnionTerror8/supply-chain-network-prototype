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
import { MODE_COLOR, MODE_LABEL, MODES_IN_LEGEND, vehicleKind } from "@/lib/visual/mode";
import { laneStoryLabel } from "@/lib/visual/story";
import { MovingVehicle, VehicleDefs } from "@/components/shared/vehicles";
import { cn } from "@/lib/utils";

type Transform = { k: number; x: number; y: number };
type Land = { type: "FeatureCollection"; features: GeoPermissibleObjects[] };

/** Fit the map to the densest cluster so one Iberian supplier does not empty the UK. */
function clusterBounds(locs: { lat: number; lng: number }[]) {
  if (!locs.length) return { minLat: 49, maxLat: 59, minLng: -8, maxLng: 2 };
  const lats = locs.map((l) => l.lat).sort((a, b) => a - b);
  const lngs = locs.map((l) => l.lng).sort((a, b) => a - b);
  const midLat = lats[Math.floor(lats.length / 2)];
  const midLng = lngs[Math.floor(lngs.length / 2)];
  const core = locs.filter((l) => Math.abs(l.lat - midLat) < 6 && Math.abs(l.lng - midLng) < 8);
  const use = core.length >= 4 ? core : locs;
  const pad = 0.45;
  return {
    minLat: Math.min(...use.map((l) => l.lat)) - pad,
    maxLat: Math.max(...use.map((l) => l.lat)) + pad,
    minLng: Math.min(...use.map((l) => l.lng)) - pad,
    maxLng: Math.max(...use.map((l) => l.lng)) + pad,
  };
}

export function MapView() {
  const { model, metrics, findings, baseline, isScenario } = useActive();
  const overlay = useWorkspace((s) => s.overlay);
  const filters = useWorkspace((s) => s.filters);
  const inspectStory = filters.inspectStory ?? "volume";
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
    const { minLat, maxLat, minLng, maxLng } = clusterBounds(model?.nodes.map((n) => n.location) ?? []);
    const box: GeoPermissibleObjects = { type: "Polygon", coordinates: [[[minLng, minLat], [minLng, maxLat], [maxLng, maxLat], [maxLng, minLat], [minLng, minLat]]] };
    return geoMercator().fitExtent([[40, 40], [size.w - 40, size.h - 40]], box);
  }, [model, size]);

  useEffect(() => {
    setT({ k: 1, x: 0, y: 0 });
  }, [model?.id]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const landPath = useMemo(() => (land ? path(land as unknown as GeoPermissibleObjects) ?? "" : ""), [land, path]);

  const vis = useMemo(() => (model ? applyFilters(model, findings, filters) : null), [model, findings, filters]);
  const sev = useMemo(() => severityIndex(findings), [findings]);
  const baselineNodeIds = useMemo(() => new Set(baseline?.nodes.map((n) => n.id) ?? []), [baseline]);
  const baselineLaneIds = useMemo(() => new Set(baseline?.lanes.map((l) => l.id) ?? []), [baseline]);
  const modelNodeIds = useMemo(() => new Set(model?.nodes.map((n) => n.id) ?? []), [model]);
  const isPeak = filters.horizon === "peak";

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

  const pairFan = useMemo(() => {
    const lanes = model?.lanes ?? [];
    const count = new Map<string, number>();
    const seq = new Map<string, number>();
    const fan = new Map<string, number>();
    const hashOff = (id: string) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
      const u = ((h >>> 0) % 11) / 10; // 0..1
      return (u - 0.5) * 1.4; // -0.7..0.7 so unique pairs do not share one arc
    };
    for (const l of lanes) count.set(`${l.from}|${l.to}`, (count.get(`${l.from}|${l.to}`) ?? 0) + 1);
    for (const l of lanes) {
      const k = `${l.from}|${l.to}`;
      const n = count.get(k) ?? 1;
      const i = seq.get(k) ?? 0;
      seq.set(k, i + 1);
      fan.set(l.id, n <= 1 ? hashOff(l.id) : (i - (n - 1) / 2) / Math.max(1, n - 1));
    }
    return fan;
  }, [model?.lanes]);

  const neighborIds = useMemo(() => {
    const id = selection?.nodeId;
    const lanes = model?.lanes ?? [];
    if (!id) return new Set<string>();
    const next = new Set<string>([id]);
    for (const l of lanes) {
      if (l.from === id) next.add(l.to);
      if (l.to === id) next.add(l.from);
    }
    return next;
  }, [model?.lanes, selection?.nodeId]);

  if (!model) return null;
  const cur = model.currency;
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const removedNodes = isScenario && baseline ? baseline.nodes.filter((n) => !modelNodeIds.has(n.id)) : [];
  const removedLanes = isScenario && baseline ? baseline.lanes.filter((l) => !model.lanes.some((x) => x.id === l.id) && baseline.nodes.some((n) => n.id === l.from) && baseline.nodes.some((n) => n.id === l.to)) : [];
  const baseNodeById = new Map(baseline?.nodes.map((n) => [n.id, n]) ?? []);
  const isActive = (nodeId?: string, laneId?: string) => (nodeId && (selection?.nodeId === nodeId || hoverId === nodeId)) || (laneId && (selection?.laneId === laneId || hoverId === laneId));
  const typesPresent = [...new Set(model.nodes.map((n) => n.type))];
  const modesPresent = [...new Set(model.lanes.map((l) => l.mode))].filter((m) => MODES_IN_LEGEND.includes(m) || m === "van" || m === "air");
  const focusNode = selection?.nodeId ?? (hoverId && nodeById.has(hoverId) ? hoverId : undefined);
  const vehicleScale = Math.min(1.15, Math.max(0.4, 1 / t.k));

  const lanePath = (a: [number, number], b: [number, number], fan = 0.55) => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const off = Math.min(36, len * 0.16) * (0.35 + Math.abs(fan));
    const sign = fan < 0 ? -1 : 1;
    return `M${a[0]},${a[1]} Q${mx - (dy / len) * off * sign},${my + (dx / len) * off * sign} ${b[0]},${b[1]}`;
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none select-none overflow-hidden bg-[var(--background)]">
      <svg width={size.w} height={size.h} className={cn("block", drag?.kind === "pan" ? "cursor-grabbing" : "cursor-grab")} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { setTip(null); setHover(null); }}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <VehicleDefs />
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          <path d={landPath} className="fill-[oklch(0.99_0.012_85)] stroke-[oklch(0.84_0.03_80)] dark:fill-[oklch(0.26_0.02_50)] dark:stroke-[oklch(0.38_0.03_60)]" vectorEffect="non-scaling-stroke" strokeWidth={0.8} />

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
            const connected = !!(focusNode && (l.from === focusNode || l.to === focusNode));
            const w = laneScale(v.value) / t.k;
            const added = isScenario && !baselineLaneIds.has(l.id);
            const d = lanePath(project(a), project(b), pairFan.get(l.id) ?? 0.55);
            const focused = active || connected;
            const showVehicle = focused && l.pattern !== "returns" && l.pattern !== "backhaul";
            return (
              <g key={l.id} opacity={dim ? 0.08 : focused ? 1 : selection?.nodeId || selection?.laneId ? 0.18 : 0.72}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(w, 10 / t.k)} className="cursor-pointer" onPointerEnter={(e) => { setHover(l.id); setTip({ ...toLocal(e), lane: l }); }} onPointerLeave={() => { setHover(null); setTip(null); }} onPointerDown={(e) => { e.stopPropagation(); select({ laneId: l.id }); }} />
                <path d={d} fill="none" stroke={active ? "var(--foreground)" : added ? "#3d7a4a" : v.color} strokeWidth={active ? w + 1.5 / t.k : w} strokeLinecap="round" strokeDasharray={added || l.pattern === "milk_run" || l.pattern === "backhaul" || l.pattern === "returns" ? `${6 / t.k} ${4 / t.k}` : `${10 / t.k} ${8 / t.k}`} className={cn("pointer-events-none", !dim && l.pattern !== "returns" && l.pattern !== "backhaul" && "flow-animated")} />
                {showVehicle ? <MovingVehicle path={d} kind={vehicleKind(l.mode)} color={v.color} dur={l.mode === "sea" ? "8s" : "4.5s"} scale={vehicleScale} /> : null}
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
            const nearFocus = neighborIds.has(n.id);
            const showLabel = active || added || nearFocus || Boolean(v.ring) || (isCustomer ? t.k > 2.8 : n.type === "national_dc" || n.type === "factory" || (n.type === "regional_dc" && t.k > 1.8) || t.k > 2.4);
            return (
              <g key={n.id} transform={`translate(${p[0]},${p[1]})`} opacity={dim ? 0.12 : 1} className="cursor-pointer" onPointerDown={(e) => onNodePointerDown(e, n)} onPointerEnter={(e) => { setHover(n.id); setTip({ ...toLocal(e), node: n }); }} onPointerLeave={() => { setHover(null); setTip(null); }}>
                {active ? <circle r={r + 6 / t.k} fill={v.color} opacity={0.25} filter="url(#glow)" /> : null}
                {v.ring ? <circle r={r + 3 / t.k} fill="none" stroke={v.ring} strokeWidth={2 / t.k} className="pulse-ring" /> : null}
                {added ? <circle r={r + 4 / t.k} fill="none" stroke="#059669" strokeWidth={1.5 / t.k} strokeDasharray={`${3 / t.k} ${2 / t.k}`} /> : null}
                <circle r={r} fill={v.color} stroke={active ? "var(--foreground)" : "var(--card)"} strokeWidth={(active ? 2 : 1.2) / t.k} className={cn(isCustomer && overlay !== "risk" && overlay !== "confidence" && "fill-opacity-70")} />
                {n.location.source !== "confirmed" && n.location.source !== "user" ? <circle r={r} fill="none" stroke="var(--card)" strokeWidth={1 / t.k} strokeDasharray={`${2 / t.k} ${2 / t.k}`} opacity={0.9} /> : null}
                {showLabel ? (
                  <text x={r + 4 / t.k} y={3.5 / t.k} fontSize={11 / t.k} className="pointer-events-none fill-foreground" style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 / t.k, fontWeight: isCustomer ? 400 : 600 }}>{n.name}</text>
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

      <div className="absolute top-3 left-3 flex max-w-[62%] flex-col gap-1.5 rounded-lg border bg-card/90 p-2 text-[10px] backdrop-blur">
        <div className="flex flex-wrap gap-1">
          {typesPresent.map((ty) => (
            <span key={ty} className="inline-flex items-center gap-1 rounded px-1 py-0.5"><span className="size-2 rounded-full" style={{ background: NODE_TYPE_META[ty].color }} />{NODE_TYPE_META[ty].short}</span>
          ))}
        </div>
        {overlay === "volume" ? (
          <div className="flex flex-wrap gap-1 border-t pt-1.5 text-muted-foreground">
            {modesPresent.map((m) => (
              <span key={m} className="inline-flex items-center gap-1 rounded px-1 py-0.5"><span className="size-2 rounded-full" style={{ background: MODE_COLOR[m] }} />{MODE_LABEL[m]}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="absolute bottom-3 left-3 rounded-lg border bg-card/90 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
        {overlay === "volume" && <>Width = cases/week{isPeak ? " · peak" : ""} · colour = transport mode · click a site to run trucks/ships on its lanes</>}
        {overlay === "cost" && <>Width = annual lane cost · size = annual facility cost</>}
        {overlay === "emissions" && <>Width & size = tCO₂e per year</>}
        {overlay === "confidence" && <>Moss confirmed → teal user → brass assumed → stone estimated → grey missing</>}
        {overlay === "risk" && <>Colour = highest finding severity; grey = none</>}
        {isScenario ? <> · <span className="text-[#3d7a4a]">green dashed = added</span> · <span className="text-[#9a4a2a]">red = removed</span></> : null}
        {" · "}names stay quiet until you select a site or zoom
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
    const loc = [n.location.city, n.location.region].filter(Boolean).join(", ");
    return (
      <>
        <div className="font-heading text-sm font-medium">{n.name}</div>
        <div className="text-muted-foreground">{NODE_TYPE_META[n.type].label}{loc ? ` · ${loc}` : ""}</div>
        {inspectStory === "volume" && nm ? (
          <div className="mt-1 grid grid-cols-2 gap-x-3 tabular-nums">
            <span>{fmtNum(nm.throughputPerWeek)} cases/wk</span>
            <span>{nm.utilisation !== undefined ? `${fmtPct(nm.utilisation)} util.` : "no capacity"}</span>
            <span>{fmtNum(nm.inboundPerWeek)} in</span>
            <span>{fmtNum(nm.outboundPerWeek)} out</span>
          </div>
        ) : null}
        {inspectStory === "cost" && nm ? (
          <div className="mt-1 grid grid-cols-2 gap-x-3 tabular-nums">
            <span>{fmtMoney(nm.annualCost, cur)}/yr</span>
            {n.handlingCostPerCase ? <span>{fmtMoney(n.handlingCostPerCase.value, cur, false)}/case handle</span> : null}
            {n.fixedCostPerYear ? <span>{fmtMoney(n.fixedCostPerYear.value, cur)} fixed</span> : null}
          </div>
        ) : null}
        {inspectStory === "lead" ? (
          <div className="mt-1 grid grid-cols-2 gap-x-3 tabular-nums">
            <span>{n.inventoryDays ? `${n.inventoryDays.value} days stock` : "stock unknown"}</span>
            <span>{n.reliability ? `${fmtPct(n.reliability.value)} OTIF` : "OTIF unknown"}</span>
          </div>
        ) : null}
        {inspectStory === "pinch" ? (
          <div className="mt-1 tabular-nums">
            <div>{nm?.utilisation !== undefined ? `${fmtPct(nm.utilisation)} utilised` : "no capacity cap"}{nm?.utilisation !== undefined && nm.utilisation >= 0.85 ? " — constrained" : ""}</div>
            {sev.nodes[n.id] ? <div className="mt-0.5 capitalize text-[#9a4a2a]">{sev.nodes[n.id]} finding</div> : <div className="text-muted-foreground">No pinchpoint on this site</div>}
          </div>
        ) : null}
        {inspectStory === "path" ? (
          <div className="mt-1 text-muted-foreground">
            {n.temperature} · {n.operator?.value ?? "operator unknown"}
            {n.capacityPerWeek ? ` · ${fmtNum(n.capacityPerWeek.value)} cap/wk` : ""}
          </div>
        ) : null}
      </>
    );
  }
  function LaneTip({ l }: { l: Lane }) {
    const lm = metrics?.laneMetrics[l.id];
    const from = nodeById.get(l.from);
    const to = nodeById.get(l.to);
    return (
      <>
        <div className="font-heading text-sm font-medium">{from?.name} → {to?.name}</div>
        <div className="text-muted-foreground">{MODE_LABEL[l.mode]} · {l.temperature}{l.pattern ? ` · ${l.pattern.replaceAll("_", " ")}` : ""}</div>
        {inspectStory === "volume" ? (
          <div className="mt-1 tabular-nums">{fmtNum(lm?.volumePerWeek ?? l.volumePerWeek.value)} cases/wk{isPeak ? " peak" : ""}{lm ? ` · ${fmtPct(lm.shareOfDestinationInbound)} of inbound` : ""}</div>
        ) : null}
        {inspectStory === "cost" && lm ? (
          <div className="mt-1 grid grid-cols-2 gap-x-3 tabular-nums">
            <span>{fmtMoney(lm.costPerCase, cur, false)}/case</span>
            <span>{fmtMoney(lm.annualCost, cur)}/yr</span>
          </div>
        ) : null}
        {inspectStory === "lead" && lm ? (
          <div className="mt-1 tabular-nums">{Math.round(lm.distanceKm)} km · {lm.transitDays.toFixed(1)} days transit</div>
        ) : null}
        {inspectStory === "pinch" ? (
          <div className="mt-1">{sev.lanes[l.id] ? <span className="capitalize text-[#9a4a2a]">{sev.lanes[l.id]} finding</span> : <span className="text-muted-foreground">Lane is not a pinchpoint</span>}</div>
        ) : null}
        {inspectStory === "path" ? (
          <div className="mt-1 text-muted-foreground">{from ? NODE_TYPE_META[from.type].short : "?"} → {to ? NODE_TYPE_META[to.type].short : "?"} · {laneStoryLabel("path", l, lm, cur, isPeak)}</div>
        ) : null}
      </>
    );
  }
}
