import type { Filters, Overlay } from "./store";
import type { Finding, Lane, NetworkMetrics, NetworkModel, NetworkNode, Provenance, Severity } from "./domain/types";
import { NODE_TYPE_META } from "./domain/types";
import { sourceWeight } from "./domain/helpers";
import { MODE_COLOR } from "./visual/mode";

const CHANNEL_NODE_TYPES = {
  ecom: new Set(["ecom_fc", "micro_fc", "dark_store"]),
  wholesale: new Set(["wholesaler"]),
} as const;

/** Resolve the global filter bar into the set of nodes and lanes that stay visible. */
export function applyFilters(model: NetworkModel, findings: Finding[], f: Filters): { nodeIds: Set<string>; laneIds: Set<string>; active: boolean } {
  const active = !!(f.productFamily || f.temperature || f.region || f.nodeTypes.length || f.riskCategory || f.channel !== "all");
  let nodes = new Set(model.nodes.map((n) => n.id));
  let lanes = new Set(model.lanes.map((l) => l.id));
  const laneById = new Map(model.lanes.map((l) => [l.id, l]));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));

  const keepLanes = (pred: (l: Lane) => boolean) => {
    lanes = new Set([...lanes].filter((id) => pred(laneById.get(id)!)));
  };
  const nodesTouchedByLanes = () => {
    const touched = new Set<string>();
    for (const id of lanes) {
      const l = laneById.get(id)!;
      touched.add(l.from);
      touched.add(l.to);
    }
    nodes = new Set([...nodes].filter((id) => touched.has(id)));
  };

  if (f.productFamily) {
    keepLanes((l) => l.productFamilies.length === 0 || l.productFamilies.includes(f.productFamily!));
    nodesTouchedByLanes();
  }
  if (f.temperature) {
    keepLanes((l) => l.temperature === f.temperature || l.temperature === "multi");
    nodes = new Set([...nodes].filter((id) => {
      const n = nodeById.get(id)!;
      return n.temperature === f.temperature || n.temperature === "multi";
    }));
  }
  if (f.channel !== "all") {
    const isChannelLane = (l: Lane) => {
      const to = nodeById.get(l.to);
      const from = nodeById.get(l.from);
      if (f.channel === "ecom") return l.mode === "parcel" || CHANNEL_NODE_TYPES.ecom.has(to?.type ?? "") || CHANNEL_NODE_TYPES.ecom.has(from?.type ?? "") || l.pattern === "last_mile";
      if (f.channel === "wholesale") return CHANNEL_NODE_TYPES.wholesale.has(to?.type ?? "") || CHANNEL_NODE_TYPES.wholesale.has(from?.type ?? "");
      return !(l.mode === "parcel" || CHANNEL_NODE_TYPES.ecom.has(to?.type ?? "") || CHANNEL_NODE_TYPES.wholesale.has(to?.type ?? ""));
    };
    // Keep channel lanes plus everything upstream of them.
    const seed = model.lanes.filter((l) => lanes.has(l.id) && isChannelLane(l));
    const keepNodes = new Set<string>();
    const stack = seed.flatMap((l) => [l.from, l.to]);
    while (stack.length) {
      const id = stack.pop()!;
      if (keepNodes.has(id)) continue;
      keepNodes.add(id);
      for (const l of model.lanes) if (l.to === id && l.pattern !== "returns" && l.pattern !== "backhaul") stack.push(l.from);
    }
    if (f.channel !== "retail") {
      nodes = new Set([...nodes].filter((id) => keepNodes.has(id)));
      keepLanes((l) => nodes.has(l.from) && nodes.has(l.to) && (isChannelLane(l) || !["store", "customer_zone", "wholesaler"].includes(nodeById.get(l.to)?.type ?? "")));
    } else {
      keepLanes((l) => isChannelLane(l));
      nodesTouchedByLanes();
    }
  }
  if (f.region) {
    const region = model.regions.find((r) => r.id === f.region);
    if (region) {
      const keepNodes = new Set<string>();
      const stack = [...region.nodeIds];
      while (stack.length) {
        const id = stack.pop()!;
        if (keepNodes.has(id)) continue;
        keepNodes.add(id);
        for (const l of model.lanes) if (l.to === id && l.pattern !== "returns" && l.pattern !== "backhaul") stack.push(l.from);
      }
      nodes = new Set([...nodes].filter((id) => keepNodes.has(id)));
      keepLanes((l) => keepNodes.has(l.from) && keepNodes.has(l.to) && (!["store", "customer_zone"].includes(nodeById.get(l.to)?.type ?? "") || region.nodeIds.includes(l.to)));
    }
  }
  if (f.nodeTypes.length) {
    nodes = new Set([...nodes].filter((id) => f.nodeTypes.includes(nodeById.get(id)!.type)));
  }
  if (f.riskCategory) {
    const hit = findings.filter((x) => x.category === f.riskCategory);
    const ns = new Set(hit.flatMap((x) => x.impacted.nodeIds));
    const ls = new Set(hit.flatMap((x) => x.impacted.laneIds));
    for (const id of ls) {
      const l = laneById.get(id);
      if (l) {
        ns.add(l.from);
        ns.add(l.to);
      }
    }
    nodes = new Set([...nodes].filter((id) => ns.has(id)));
    keepLanes((l) => ls.has(l.id) || (ns.has(l.from) && ns.has(l.to)));
  }
  keepLanes((l) => nodes.has(l.from) && nodes.has(l.to));
  return { nodeIds: nodes, laneIds: lanes, active };
}

const SEV_RANK: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function worstSeverity(a?: Severity, b?: Severity): Severity | undefined {
  if (!a) return b;
  if (!b) return a;
  return SEV_RANK[a] >= SEV_RANK[b] ? a : b;
}

/** Highest finding severity touching each node / lane. */
export function severityIndex(findings: Finding[]) {
  const nodes: Record<string, Severity> = {};
  const lanes: Record<string, Severity> = {};
  for (const f of findings) {
    if (f.category === "opportunity" || f.category === "data_quality") continue;
    for (const id of f.impacted.nodeIds) nodes[id] = worstSeverity(nodes[id], f.severity)!;
    for (const id of f.impacted.laneIds) lanes[id] = worstSeverity(lanes[id], f.severity)!;
  }
  return { nodes, lanes };
}

/** Evidence score 0..1 for a node based on provenance of its key fields. */
export function nodeEvidence(n: NetworkNode): number {
  const fields = [n.capacityPerWeek, n.inventoryDays, n.fixedCostPerYear, n.handlingCostPerCase, n.reliability];
  const w = fields.map((t) => (t ? sourceWeight(t.source) : 0));
  const loc = sourceWeight(n.location.source);
  return (w.reduce((a, b) => a + b, 0) + loc) / (fields.length + 1);
}

export function laneEvidence(l: Lane): number {
  const fields = [l.volumePerWeek, l.costPerCase, l.transitDays, l.reliability];
  return fields.map((t) => (t ? sourceWeight(t.source) : 0)).reduce((a, b) => a + b, 0) / fields.length;
}

export function dominantSource(l: Lane): Provenance {
  return l.costPerCase?.source ?? l.volumePerWeek.source;
}

export const SEVERITY_HEX: Record<Severity, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#2a6a78",
  info: "#78716c",
};

export const PROVENANCE_HEX: Record<Provenance, string> = {
  confirmed: "#3d7a4a",
  user: "#2a6a78",
  assumed: "#c2782a",
  ai: "#6b6560",
  missing: "#a8a29e",
};

export function evidenceColor(e: number) {
  if (e >= 0.8) return PROVENANCE_HEX.confirmed;
  if (e >= 0.55) return PROVENANCE_HEX.user;
  if (e >= 0.35) return PROVENANCE_HEX.assumed;
  if (e > 0.1) return PROVENANCE_HEX.ai;
  return PROVENANCE_HEX.missing;
}

/** Visual encodings shared by map, network and flow views. */
export function laneVisual(overlay: Overlay, lane: Lane, metrics: NetworkMetrics | null, severity?: Severity) {
  const lm = metrics?.laneMetrics[lane.id];
  const vol = lm?.volumePerWeek ?? lane.volumePerWeek.value;
  let value = vol;
  if (overlay === "cost") value = lm?.annualCost ?? 0;
  if (overlay === "emissions") value = lm?.annualEmissionsTonnes ?? 0;
  let color = MODE_COLOR[lane.mode] ?? "#57534e";
  if (overlay === "confidence") color = evidenceColor(laneEvidence(lane));
  else if (overlay === "risk") color = severity ? SEVERITY_HEX[severity] : "#a8a29e";
  else if (overlay === "cost") color = "#9a4a2a";
  else if (overlay === "emissions") color = "#0f6f73";
  return { value, color, pattern: lane.pattern };
}

export function nodeVisual(overlay: Overlay, node: NetworkNode, metrics: NetworkMetrics | null, severity?: Severity) {
  const nm = metrics?.nodeMetrics[node.id];
  let value = nm?.throughputPerWeek ?? 0;
  if (overlay === "cost") value = nm?.annualCost ?? 0;
  if (overlay === "emissions") value = nm?.emissionsTonnes ?? 0;
  let color = NODE_TYPE_META[node.type].color;
  let ring: string | undefined;
  if (overlay === "confidence") color = evidenceColor(nodeEvidence(node));
  if (overlay === "risk") {
    color = severity ? SEVERITY_HEX[severity] : "#cbd5e1";
  }
  if (nm?.utilisation !== undefined && nm.utilisation >= 0.85 && overlay !== "risk") ring = nm.utilisation >= 0.95 ? SEVERITY_HEX.critical : SEVERITY_HEX.high;
  return { value, color, ring, utilisation: nm?.utilisation };
}

export function sqrtScale(values: number[], min: number, max: number) {
  const top = Math.max(1, ...values);
  return (v: number) => min + (max - min) * Math.sqrt(Math.max(0, v) / top);
}
