import { roadKm } from "../domain/geo";
import { aiEstimate, assumed, cloneModel, fmtMoney, fmtNum, fmtPct, uid } from "../domain/helpers";
import type {
  Confidence,
  Lane,
  NetworkMetrics,
  NetworkModel,
  NetworkNode,
  NodeType,
  Scenario,
  ScenarioChange,
} from "../domain/types";
import { computeMetrics, costToServe } from "./metrics";

const CUSTOMER_TYPES = new Set<NodeType>(["store", "customer_zone", "wholesaler"]);

function nearest(model: NetworkModel, from: NetworkNode, candidates: NetworkNode[]) {
  let best: NetworkNode | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = roadKm(from.location, c.location);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? { node: best, km: bestD } : undefined;
}

/**
 * Create an estimated lane. When a reference lane with a priced rate is supplied, the
 * new rate is scaled from it by distance (bounded), which is more credible than a
 * generic per-km benchmark for long or international legs.
 */
function estimateLane(
  model: NetworkModel,
  from: NetworkNode,
  to: NetworkNode,
  template: Partial<Lane>,
  volume: number,
  note: string,
  reference?: { costPerCase: number; km: number; source: Lane["volumePerWeek"]["source"] },
): Lane {
  const km = roadKm(from.location, to.location);
  const mode = template.mode ?? "road";
  const temp = template.temperature ?? (from.temperature === "multi" ? to.temperature : from.temperature);
  const uplift = temp === "chilled" ? 1.18 : temp === "frozen" ? 1.25 : 1;
  let cost = (model.parameters.costPerCaseKm[mode].value * km + model.parameters.laneHandlingPerCase.value) * uplift;
  let costNote = `Estimated: ${Math.round(km)} km × ${mode} rate + handling`;
  if (reference && reference.km > 0 && (reference.source === "confirmed" || reference.source === "user")) {
    const ratio = Math.min(1.8, Math.max(0.7, km / reference.km));
    cost = reference.costPerCase * ratio;
    costNote = `Scaled from the previous confirmed rate (${reference.costPerCase.toFixed(2)}/case) by distance ×${ratio.toFixed(2)}`;
  }
  return {
    id: uid("lane"),
    from: from.id,
    to: to.id,
    mode,
    temperature: temp,
    productFamilies: template.productFamilies ?? [],
    volumePerWeek: aiEstimate(Math.round(volume), note),
    costPerCase: aiEstimate(Number(cost.toFixed(2)), costNote),
    transitDays: aiEstimate(Number((0.15 + km / 550).toFixed(1)), "Estimated from road distance"),
    reliability: assumed(0.94, "Network default for new lanes"),
    pattern: template.pattern,
    crossesBorder: template.crossesBorder,
  };
}

const isFlowLane = (l: Lane) => l.pattern !== "returns" && l.pattern !== "backhaul";

function refFrom(model: NetworkModel, lane: Lane, lookup?: (id: string) => NetworkNode | undefined) {
  if (!lane.costPerCase) return undefined;
  const find = lookup ?? ((id: string) => model.nodes.find((n) => n.id === id));
  const a = find(lane.from);
  const b = find(lane.to);
  if (!a || !b) return undefined;
  return { costPerCase: lane.costPerCase.value, km: lane.distanceKm?.value ?? roadKm(a.location, b.location), source: lane.costPerCase.source };
}

/**
 * Family-aware upstream reduction used when a product family is re-routed around a
 * facility: shrink only the inbound lanes that carry that family, and stop at the
 * facilities that now ship it directly (their net outbound is unchanged).
 */
function reduceInboundForFamily(model: NetworkModel, nodeId: string, familyId: string, amount: number, stopTypes: Set<string>, before: OutboundSnapshot, depth = 0) {
  if (amount <= 0 || depth > 6) return;
  const inL = model.lanes.filter((l) => l.to === nodeId && isFlowLane(l) && l.productFamilies.includes(familyId));
  const total = inL.reduce((s, l) => s + l.volumePerWeek.value, 0);
  if (!inL.length || total <= 0) return;
  before.set(nodeId, Math.max(0, (before.get(nodeId) ?? 0) - amount));
  for (const l of inL) {
    const cut = Math.min(l.volumePerWeek.value, Math.round((amount * l.volumePerWeek.value) / total));
    l.volumePerWeek = { ...l.volumePerWeek, value: l.volumePerWeek.value - cut, source: "ai", note: `Reduced by ${fmtNum(cut)} cases/wk now shipped direct` };
    const src = model.nodes.find((n) => n.id === l.from);
    if (src && !stopTypes.has(src.type)) reduceInboundForFamily(model, src.id, familyId, cut, stopTypes, before, depth + 1);
  }
}

/** Snapshot of outbound volume per node, taken before changes are applied. */
export type OutboundSnapshot = Map<string, number>;

export function snapshotOutbound(model: NetworkModel): OutboundSnapshot {
  const m = new Map<string, number>();
  for (const l of model.lanes) if (isFlowLane(l)) m.set(l.from, (m.get(l.from) ?? 0) + l.volumePerWeek.value);
  return m;
}

/**
 * Propagate a change in a node's outbound volume to its inbound lanes, relative to the
 * pre-change snapshot. Scaling relative to the snapshot (rather than forcing inbound to
 * equal outbound) preserves intentional yield / loss ratios present in the baseline data.
 */
function rebalanceUpstream(model: NetworkModel, startIds: string[], before: OutboundSnapshot) {
  const visited = new Set<string>();
  const queue = [...startIds];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = model.nodes.find((n) => n.id === id);
    if (!node || CUSTOMER_TYPES.has(node.type) || node.type === "farm" || node.type === "supplier") continue;
    const outL = model.lanes.filter((l) => l.from === id && isFlowLane(l));
    const inL = model.lanes.filter((l) => l.to === id && isFlowLane(l));
    const out = outL.reduce((s, l) => s + l.volumePerWeek.value, 0);
    const prevOut = before.get(id) ?? 0;
    if (!inL.length || prevOut === 0) continue;
    const ratio = out / prevOut;
    if (Math.abs(ratio - 1) < 0.005) continue;
    before.set(id, out);
    for (const l of inL) {
      const nv = Math.round(l.volumePerWeek.value * ratio);
      l.volumePerWeek = { ...l.volumePerWeek, value: nv, source: l.volumePerWeek.source === "confirmed" ? "ai" : l.volumePerWeek.source, note: `Rebalanced ×${ratio.toFixed(2)} to follow downstream demand` };
      queue.push(l.from);
    }
  }
}

export function applyChange(model: NetworkModel, change: ScenarioChange, before: OutboundSnapshot = snapshotOutbound(model)): string[] {
  const log: string[] = [];
  switch (change.type) {
    case "add_node": {
      const node = { ...change.node };
      if (model.nodes.some((n) => n.id === node.id)) node.id = uid("node");
      model.nodes.push(node);
      log.push(`Added ${node.name} (${node.type.replace("_", " ")}) at ${node.location.city ?? "custom location"}.`);
      if (change.serveNearest?.length) {
        const feeder = change.feedFrom ? model.nodes.find((n) => n.id === change.feedFrom) : undefined;
        const peers = model.nodes.filter((n) => n.id !== node.id && (n.type === node.type || n.type === "cross_dock" || n.type === "regional_dc" || n.type === "national_dc"));
        let moved = 0;
        const movedLanes: Lane[] = [];
        for (const cust of model.nodes.filter((n) => change.serveNearest!.includes(n.type))) {
          const dNew = roadKm(node.location, cust.location);
          const inL = model.lanes.filter((l) => l.to === cust.id && l.pattern !== "returns" && l.pattern !== "backhaul");
          for (const l of inL) {
            const src = model.nodes.find((n) => n.id === l.from);
            if (!src || !peers.some((p) => p.id === src.id)) continue;
            const dOld = roadKm(src.location, cust.location);
            // Only move a customer when the new site is materially nearer and the current
            // stem is long enough that an extra handling step is worth it.
            const regionalSource = src.type === "regional_dc" || src.type === "cross_dock";
            if (dNew < dOld * 0.75 && dNew < 220 && (regionalSource || dOld > 120)) {
              const nl = estimateLane(model, node, cust, { productFamilies: l.productFamilies, temperature: l.temperature, pattern: "direct" }, l.volumePerWeek.value, `Reassigned from ${src.name} (nearer by ${Math.round(dOld - dNew)} km)`, refFrom(model, l));
              movedLanes.push(nl);
              model.lanes = model.lanes.filter((x) => x.id !== l.id);
              moved += l.volumePerWeek.value;
              log.push(`Reassigned ${cust.name} (${fmtNum(l.volumePerWeek.value)} cases/wk) from ${src.name} to ${node.name}.`);
            }
          }
        }
        model.lanes.push(...movedLanes);
        if (moved > 0) {
          const src = feeder ?? model.nodes.find((n) => n.type === "national_dc") ?? model.nodes.find((n) => n.type === "factory");
          if (src) {
            model.lanes.push(estimateLane(model, src, node, { productFamilies: [...new Set(movedLanes.flatMap((l) => l.productFamilies))], temperature: node.temperature === "multi" ? "chilled" : node.temperature }, moved, `Trunk feed for reassigned volume`));
            log.push(`Created trunk lane ${src.name} → ${node.name} carrying ${fmtNum(moved)} cases/wk.`);
          }
          rebalanceUpstream(model, peers.map((p) => p.id), before);
        } else {
          log.push(`No customers were materially nearer to ${node.name}; no flows reassigned.`);
        }
      }
      break;
    }
    case "remove_node": {
      const node = model.nodes.find((n) => n.id === change.nodeId);
      if (!node) break;
      const nodesBefore = new Map(model.nodes.map((n) => [n.id, n]));
      const lookup = (id: string) => nodesBefore.get(id);
      const outL = model.lanes.filter((l) => l.from === node.id);
      const inL = model.lanes.filter((l) => l.to === node.id);
      model.nodes = model.nodes.filter((n) => n.id !== node.id);
      model.lanes = model.lanes.filter((l) => l.from !== node.id && l.to !== node.id);
      log.push(`Removed ${node.name} and ${outL.length + inL.length} connected lanes.`);
      if (change.reassign) {
        const peers = model.nodes.filter((n) => n.type === node.type || (node.type === "regional_dc" && n.type === "national_dc") || (node.type === "port" && n.type === "port"));
        if (node.type === "port") {
          // Gateway outage: divert supplier flows through the nearest alternative gateway
          // and continue to the same receiving sites. Procurement is unchanged.
          const alt = nearest(model, node, peers);
          if (!alt) {
            log.push(`No alternative gateway: ${fmtNum(outL.reduce((s, l) => s + l.volumePerWeek.value, 0))} cases/wk of imports cannot enter the network and are flagged as unserved.`);
            model.assumptions.push({ id: uid("a"), text: `${node.name} has no alternative gateway in the model; its ${fmtNum(outL.reduce((s, l) => s + l.volumePerWeek.value, 0))} cases/week are unserved in this scenario.`, source: "ai", sensitivity: "high" });
            for (const l of outL) {
              const dest = model.nodes.find((n) => n.id === l.to);
              if (dest) before.set(dest.id, before.get(dest.id) ?? 0);
            }
          } else {
            for (const l of inL) {
              const src = model.nodes.find((n) => n.id === l.from);
              if (!src) continue;
              const diverted = estimateLane(model, src, alt.node, { productFamilies: l.productFamilies, temperature: l.temperature, mode: l.mode, crossesBorder: true }, l.volumePerWeek.value, `Diverted from ${node.name}`, refFrom(model, l, lookup));
              // Surge at an unfamiliar gateway: slower clearance and lower reliability until processes settle.
              diverted.transitDays = aiEstimate(Number(((diverted.transitDays?.value ?? 1) + 1).toFixed(1)), "Diversion adds ~1 day of clearance and repositioning");
              diverted.reliability = assumed(0.85, "Alternate gateway under surge conditions");
              model.lanes.push(diverted);
              log.push(`Diverted ${src.name} (${fmtNum(l.volumePerWeek.value)} cases/wk) via ${alt.node.name}.`);
            }
            for (const l of outL) {
              const dest = model.nodes.find((n) => n.id === l.to);
              if (!dest) continue;
              model.lanes.push(estimateLane(model, alt.node, dest, { productFamilies: l.productFamilies, temperature: l.temperature, mode: l.mode }, l.volumePerWeek.value, `Onward from ${alt.node.name} replacing ${node.name}`, refFrom(model, l, lookup)));
              log.push(`Added onward lane ${alt.node.name} → ${dest.name} (+${Math.round(alt.km)} km detour).`);
            }
            // Alternative gateway's reliability typically degrades under surge; record it.
            model.assumptions.push({ id: uid("a"), text: `${alt.node.name} absorbs ${node.name}'s volume without a hard capacity constraint; diverted lanes assume +1 day transit and 85% reliability under surge.`, source: "ai", sensitivity: "high" });
          }
        } else if (node.type === "farm" || node.type === "supplier") {
          // Upstream node: redistribute its outbound volume across peers already feeding the same destinations.
          for (const l of outL) {
            const dest = model.nodes.find((n) => n.id === l.to);
            if (!dest) continue;
            const alt = model.lanes.filter((x) => x.to === l.to && peers.some((p) => p.id === x.from));
            if (alt.length) {
              const share = l.volumePerWeek.value / alt.length;
              for (const a of alt) {
                a.volumePerWeek = aiEstimate(Math.round(a.volumePerWeek.value + share), `Uplifted to absorb ${node.name} volume`);
              }
              log.push(`Spread ${fmtNum(l.volumePerWeek.value)} cases/wk across ${alt.length} alternative source lane${alt.length > 1 ? "s" : ""} into ${dest.name}.`);
            } else {
              const peerNear = nearest(model, dest, peers.filter((p) => p.id !== dest.id));
              if (peerNear) {
                model.lanes.push(estimateLane(model, peerNear.node, dest, { productFamilies: l.productFamilies, temperature: l.temperature, mode: l.mode, crossesBorder: l.crossesBorder }, l.volumePerWeek.value, `Replaces ${node.name}`, refFrom(model, l, lookup)));
                log.push(`Created new lane ${peerNear.node.name} → ${dest.name} for ${fmtNum(l.volumePerWeek.value)} cases/wk.`);
              } else {
                log.push(`No alternative source for ${fmtNum(l.volumePerWeek.value)} cases/wk into ${dest.name}: flagged as unserved.`);
                model.assumptions.push({ id: uid("a"), text: `${fmtNum(l.volumePerWeek.value)} cases/week previously from ${node.name} cannot be sourced in this scenario.`, source: "ai", sensitivity: "high" });
              }
            }
          }
          // Shrink destinations' downstream if unserved? Keep demand; metrics flag capacity.
        } else {
          // Downstream facility: reassign customers to nearest peer, extend feeds.
          const addedByFeeder = new Map<string, number>();
          for (const l of outL) {
            const dest = model.nodes.find((n) => n.id === l.to);
            if (!dest) continue;
            const peerNear = nearest(model, dest, peers);
            if (!peerNear) {
              log.push(`No alternative for ${dest.name}; demand of ${fmtNum(l.volumePerWeek.value)} cases/wk unserved.`);
              continue;
            }
            model.lanes.push(estimateLane(model, peerNear.node, dest, { productFamilies: l.productFamilies, temperature: l.temperature, pattern: l.pattern }, l.volumePerWeek.value, `Reassigned from ${node.name}`, refFrom(model, l, lookup)));
            addedByFeeder.set(peerNear.node.id, (addedByFeeder.get(peerNear.node.id) ?? 0) + l.volumePerWeek.value);
            log.push(`Reassigned ${dest.name} to ${peerNear.node.name} (+${Math.round(peerNear.km)} km stem).`);
          }
          // Peers that gained volume scale their inbound up; the removed node's former
          // feeders have lost outbound and scale their inbound down.
          rebalanceUpstream(model, [...addedByFeeder.keys(), ...inL.map((l) => l.from)], before);
        }
      }
      break;
    }
    case "update_node": {
      const node = model.nodes.find((n) => n.id === change.nodeId);
      if (!node) break;
      Object.assign(node, change.patch);
      log.push(`Updated ${node.name}: ${change.label}.`);
      break;
    }
    case "add_lane": {
      model.lanes.push({ ...change.lane, id: model.lanes.some((l) => l.id === change.lane.id) ? uid("lane") : change.lane.id });
      const f = model.nodes.find((n) => n.id === change.lane.from)?.name;
      const t = model.nodes.find((n) => n.id === change.lane.to)?.name;
      log.push(`Added lane ${f} → ${t} (${fmtNum(change.lane.volumePerWeek.value)} cases/wk).`);
      break;
    }
    case "remove_lane": {
      const l = model.lanes.find((x) => x.id === change.laneId);
      model.lanes = model.lanes.filter((x) => x.id !== change.laneId);
      if (l) log.push(`Removed lane ${model.nodes.find((n) => n.id === l.from)?.name} → ${model.nodes.find((n) => n.id === l.to)?.name}.`);
      break;
    }
    case "update_lane": {
      const l = model.lanes.find((x) => x.id === change.laneId);
      if (!l) break;
      Object.assign(l, change.patch);
      log.push(`Updated lane: ${change.label}.`);
      break;
    }
    case "demand_change": {
      const region = change.regionId ? model.regions.find((r) => r.id === change.regionId) : undefined;
      const targets = new Set(region ? region.nodeIds : model.nodes.filter((n) => CUSTOMER_TYPES.has(n.type)).map((n) => n.id));
      const touched = new Set<string>();
      for (const l of model.lanes) {
        if (!targets.has(l.to) || l.pattern === "returns") continue;
        if (change.productFamilyId && l.productFamilies.length && !l.productFamilies.includes(change.productFamilyId)) continue;
        l.volumePerWeek = { ...l.volumePerWeek, value: Math.round(l.volumePerWeek.value * change.factor), source: "ai", note: `Scenario: demand × ${change.factor.toFixed(2)}` };
        touched.add(l.from);
      }
      rebalanceUpstream(model, [...touched], before);
      log.push(`${change.label}: scaled ${region ? region.name : "all"} demand by ${fmtPct(change.factor - 1)} and rebalanced upstream flows.`);
      break;
    }
    case "direct_to_store": {
      const fam = model.productFamilies.find((f) => f.id === change.productFamilyId);
      const all = model.nodes.filter((n) => n.type === change.fromType);
      // Prefer sources that actually ship this family today.
      const making = all.filter((n) => model.lanes.some((l) => l.from === n.id && l.productFamilies.includes(change.productFamilyId)));
      const sources = making.length ? making : all;
      if (!sources.length) {
        log.push(`No ${change.fromType} nodes found to ship direct from.`);
        break;
      }
      let moved = 0;
      const movedFrom = new Map<string, number>();
      const direct = fam?.temperature ?? "ambient";
      for (const l of [...model.lanes]) {
        const dest = model.nodes.find((n) => n.id === l.to);
        const src = model.nodes.find((n) => n.id === l.from);
        if (!dest || !src || !CUSTOMER_TYPES.has(dest.type) || !l.productFamilies.includes(change.productFamilyId)) continue;
        if (!["regional_dc", "national_dc", "cross_dock"].includes(src.type)) continue;
        const weight = (id: string) => model.productFamilies.find((f) => f.id === id)?.shareOfVolume?.value ?? 1;
        const share = weight(change.productFamilyId) / l.productFamilies.reduce((s, f) => s + weight(f), 0);
        const vol = Math.round(l.volumePerWeek.value * share);
        if (vol < 200) continue;
        const near = nearest(model, dest, sources);
        if (!near) continue;
        l.volumePerWeek = { ...l.volumePerWeek, value: l.volumePerWeek.value - vol, source: "ai", note: `${fam?.name ?? "Family"} share moved to direct` };
        l.productFamilies = l.productFamilies.filter((f) => f !== change.productFamilyId);
        // Direct multi-drop loads are smaller than trunk loads: apply a 1.6× rate factor to the distance estimate.
        const nl = estimateLane(model, near.node, dest, { productFamilies: [change.productFamilyId], temperature: direct === "multi" ? "chilled" : direct, pattern: "direct" }, vol, `Direct delivery bypassing ${src.name}`);
        nl.costPerCase = aiEstimate(Number((nl.costPerCase!.value * 1.6).toFixed(2)), "Distance estimate × 1.6 multi-drop factor (smaller loads than trunking)");
        model.lanes.push(nl);
        moved += vol;
        movedFrom.set(src.id, (movedFrom.get(src.id) ?? 0) + vol);
      }
      const stop = new Set<string>([change.fromType, "farm", "supplier"]);
      for (const [dcId, amount] of movedFrom) reduceInboundForFamily(model, dcId, change.productFamilyId, amount, stop, before);
      log.push(`Moved ${fmtNum(moved)} cases/wk of ${fam?.name ?? change.productFamilyId} to direct delivery from ${sources.map((s) => s.name).join(" / ")}; reduced the matching trunk volumes into ${movedFrom.size} DC${movedFrom.size === 1 ? "" : "s"}.`);
      model.assumptions.push({ id: uid("a"), text: `Direct ${fam?.name ?? "product"} deliveries are priced at 1.6× the trunk rate per case-km to reflect smaller multi-drop loads.`, source: "assumed", sensitivity: "high" });
      break;
    }
    case "convert_to_cross_dock": {
      for (const id of change.nodeIds) {
        const node = model.nodes.find((n) => n.id === id);
        if (!node) continue;
        node.type = "cross_dock";
        node.name = node.name.replace(/RDC|Regional DC/i, "Cross-dock");
        node.inventoryDays = aiEstimate(0.3, "Cross-dock: same-day flow-through");
        node.handlingCostPerCase = aiEstimate((node.handlingCostPerCase?.value ?? 0.5) * 0.6, "Cross-dock handling, no put-away/pick");
        if (node.fixedCostPerYear) node.fixedCostPerYear = aiEstimate(Math.round(node.fixedCostPerYear.value * 0.7), "Smaller footprint, no racking");
        log.push(`Converted ${node.name} to a cross-dock for ${change.productFamilyIds.join(", ")}: inventory to 0.3 days, handling −40%, fixed cost −30%.`);
        for (const l of model.lanes.filter((x) => x.to === id)) {
          l.transitDays = l.transitDays ? { ...l.transitDays, value: l.transitDays.value + 0.3, source: "ai", note: "Pre-sorted consolidation at origin adds dwell" } : undefined;
        }
      }
      model.rules.push({ id: uid("rule"), text: `Fast-moving lines (${change.productFamilyIds.join(", ")}) are pre-allocated at the national DC and cross-docked at ${change.nodeIds.length} regional site(s) within 12 hours.`, kind: "allocation", active: true, createdBy: "agent" });
      break;
    }
    case "move_channel": {
      const from = model.nodes.find((n) => n.id === change.from);
      const to = model.nodes.find((n) => n.id === change.to);
      if (!from || !to) break;
      let moved = 0;
      for (const l of model.lanes.filter((x) => x.from === from.id && (x.mode === "parcel" || x.mode === "van" || x.pattern === "last_mile"))) {
        l.from = to.id;
        l.volumePerWeek = { ...l.volumePerWeek, source: "ai", note: `Re-originated from ${to.name}` };
        moved += l.volumePerWeek.value;
      }
      rebalanceUpstream(model, [to.id, from.id], before);
      log.push(`Moved ${fmtNum(moved)} cases/wk of e-commerce fulfilment from ${from.name} to ${to.name}.`);
      break;
    }
    case "add_rule": {
      model.rules.push(change.rule);
      log.push(`Added rule: “${change.rule.text}”.`);
      break;
    }
  }
  return log;
}

export function applyScenario(baseline: NetworkModel, scenario: Scenario): { model: NetworkModel; log: string[] } {
  const model = cloneModel(baseline);
  model.id = `${baseline.id}__${scenario.id}`;
  model.name = `${baseline.name} — ${scenario.name}`;
  const log: string[] = [];
  const before = snapshotOutbound(model);
  for (const c of scenario.changes) log.push(...applyChange(model, c, before));
  return { model, log };
}

export interface ComparisonRow {
  key: string;
  label: string;
  baseline: number;
  scenario: number;
  delta: number;
  deltaPct: number;
  format: "money" | "pct" | "days" | "num" | "score" | "tonnes" | "kg";
  betterWhen: "lower" | "higher";
  group: "financial" | "service" | "operational" | "risk" | "sustainability" | "confidence";
}

export interface Comparison {
  rows: ComparisonRow[];
  costLines: { component: string; label: string; baseline: number; scenario: number; delta: number }[];
  headline: string;
  benefits: string[];
  tradeOffs: string[];
  limitations: string[];
  enablers: string[];
  confidence: Confidence;
  confidenceNote: string;
  netAnnualDelta: number;
}

export function compareMetrics(baseline: NetworkMetrics, scenario: NetworkMetrics, model: NetworkModel, scen: Scenario, log: string[]): Comparison {
  const row = (key: string, label: string, b: number, s: number, format: ComparisonRow["format"], betterWhen: ComparisonRow["betterWhen"], group: ComparisonRow["group"]): ComparisonRow => ({
    key, label, baseline: b, scenario: s, delta: s - b, deltaPct: b ? (s - b) / Math.abs(b) : 0, format, betterWhen, group,
  });
  const rows: ComparisonRow[] = [
    row("cts", "Cost-to-serve", costToServe(baseline), costToServe(scenario), "money", "lower", "financial"),
    row("total", "Network operating cost", baseline.totalAnnualCost, scenario.totalAnnualCost, "money", "lower", "financial"),
    row("cpc", "Cost per case delivered", baseline.costPerCase, scenario.costPerCase, "money", "lower", "financial"),
    row("proc", "Goods purchased (procurement)", baseline.procurementAnnual, scenario.procurementAnnual, "money", "lower", "financial"),
    row("cases", "Cases delivered / yr", baseline.annualCases, scenario.annualCases, "num", "higher", "financial"),
    row("inv", "Inventory value", baseline.inventoryValue, scenario.inventoryValue, "money", "lower", "financial"),
    row("svc", "Expected service level", baseline.serviceLevel, scenario.serviceLevel, "pct", "higher", "service"),
    row("lt", "Avg. delivery lead time", baseline.avgLeadTimeDays, scenario.avgLeadTimeDays, "days", "lower", "service"),
    row("util", "Avg. facility utilisation", baseline.avgUtilisation, scenario.avgUtilisation, "pct", "lower", "operational"),
    row("constrained", "Constrained facilities", baseline.constrainedNodes, scenario.constrainedNodes, "num", "lower", "operational"),
    row("invdays", "Inventory days (weighted)", baseline.inventoryDaysWeighted, scenario.inventoryDaysWeighted, "days", "lower", "operational"),
    row("risk", "Risk score", baseline.riskScore, scenario.riskScore, "score", "lower", "risk"),
    row("res", "Resilience score", baseline.resilienceScore, scenario.resilienceScore, "score", "higher", "risk"),
    row("co2", "Emissions (tCO2e / yr)", baseline.emissionsTonnes, scenario.emissionsTonnes, "tonnes", "lower", "sustainability"),
    row("co2pc", "Emissions per case", baseline.emissionsPerCaseKg, scenario.emissionsPerCaseKg, "kg", "lower", "sustainability"),
    row("conf", "Data confidence", baseline.confidenceScore, scenario.confidenceScore, "pct", "higher", "confidence"),
  ];
  const comps = new Set([...baseline.costLines.map((l) => l.component), ...scenario.costLines.map((l) => l.component)]);
  const costLines = [...comps].map((c) => {
    const b = baseline.costLines.find((l) => l.component === c)?.annual ?? 0;
    const s = scenario.costLines.find((l) => l.component === c)?.annual ?? 0;
    return { component: c, label: c, baseline: b, scenario: s, delta: s - b };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const cur = model.currency;
  const dCost = scenario.totalAnnualCost - baseline.totalAnnualCost;
  const dSvc = (scenario.serviceLevel - baseline.serviceLevel) * 100;
  const dRisk = scenario.riskScore - baseline.riskScore;
  const dCo2 = scenario.emissionsTonnes - baseline.emissionsTonnes;
  const dInv = scenario.inventoryValue - baseline.inventoryValue;
  const dLt = scenario.avgLeadTimeDays - baseline.avgLeadTimeDays;
  const dCases = baseline.annualCases ? (scenario.annualCases - baseline.annualCases) / baseline.annualCases : 0;
  const volumeChanged = Math.abs(dCases) > 0.02;
  const dCpc = scenario.costPerCase - baseline.costPerCase;

  const benefits: string[] = [];
  const tradeOffs: string[] = [];
  if (volumeChanged) {
    benefits.push(`Volume delivered changes by ${fmtPct(dCases, 1)}; judge cost on a per-case basis.`);
    if (dCpc < -0.005) benefits.push(`Cost per case falls by ${fmtMoney(-dCpc, cur, false)} (${fmtPct(-dCpc / baseline.costPerCase, 1)}) as fixed costs spread over more volume.`);
    if (dCpc > 0.005) tradeOffs.push(`Cost per case rises by ${fmtMoney(dCpc, cur, false)} (${fmtPct(dCpc / baseline.costPerCase, 1)}), mostly from capacity strain and longer stems.`);
    tradeOffs.push(`Network operating cost moves by ${fmtMoney(dCost, cur)} a year in absolute terms.`);
  } else {
    if (dCost < -1000) benefits.push(`Reduces network operating cost by ${fmtMoney(-dCost, cur)} a year (${fmtPct(-dCost / baseline.totalAnnualCost, 1)}).`);
    if (dCost > 1000) tradeOffs.push(`Increases network operating cost by ${fmtMoney(dCost, cur)} a year (${fmtPct(dCost / baseline.totalAnnualCost, 1)}).`);
  }
  if (dSvc > 0.1) benefits.push(`Improves expected service level by ${dSvc.toFixed(1)} points.`);
  if (dSvc < -0.1) tradeOffs.push(`Lowers expected service level by ${(-dSvc).toFixed(1)} points.`);
  if (dLt < -0.05) benefits.push(`Shortens average delivery lead time by ${(-dLt).toFixed(1)} days.`);
  if (dLt > 0.05) tradeOffs.push(`Lengthens average delivery lead time by ${dLt.toFixed(1)} days.`);
  if (dRisk < -1) benefits.push(`Lowers the network risk score by ${-dRisk} points.`);
  if (dRisk > 1) tradeOffs.push(`Raises the network risk score by ${dRisk} points.`);
  if (dCo2 < -5) benefits.push(`Cuts emissions by ${fmtNum(-dCo2)} tCO2e a year.`);
  if (dCo2 > 5) tradeOffs.push(`Adds ${fmtNum(dCo2)} tCO2e a year.`);
  if (dInv < -10000) benefits.push(`Releases ${fmtMoney(-dInv, cur)} of working capital.`);
  if (dInv > 10000) tradeOffs.push(`Ties up ${fmtMoney(dInv, cur)} more working capital.`);
  if (scenario.constrainedNodes < baseline.constrainedNodes) benefits.push(`Relieves ${baseline.constrainedNodes - scenario.constrainedNodes} constrained facilit${baseline.constrainedNodes - scenario.constrainedNodes > 1 ? "ies" : "y"}.`);
  if (scenario.constrainedNodes > baseline.constrainedNodes) tradeOffs.push(`Pushes ${scenario.constrainedNodes - baseline.constrainedNodes} more facilit${scenario.constrainedNodes - baseline.constrainedNodes > 1 ? "ies" : "y"} above the ${fmtPct(model.parameters.constrainedUtilisation.value)} utilisation threshold.`);
  if (scenario.unservedCasesPerWeek > baseline.unservedCasesPerWeek + 100) tradeOffs.push(`${fmtNum(scenario.unservedCasesPerWeek - baseline.unservedCasesPerWeek)} cases/week exceed available capacity and would be unserved.`);
  if (!benefits.length) benefits.push("No material improvement detected against the baseline on the measured dimensions.");
  if (!tradeOffs.length) tradeOffs.push("No material trade-offs detected on the measured dimensions.");

  const limitations = [
    "Flows are reassigned by nearest-facility logic, not a full optimisation; a solver may find a better allocation.",
    "New lanes and facilities use benchmark costs until quotes are loaded.",
    ...(scenario.confidenceScore < baseline.confidenceScore - 0.03 ? ["This scenario introduces more estimated values than the baseline; its ranges are wider."] : []),
  ];
  const enablers = scen.enablers.length ? scen.enablers : inferEnablers(scen);

  const confScore = Math.min(baseline.confidenceScore, scenario.confidenceScore) - (scen.changes.some((c) => c.type === "add_node") ? 0.1 : 0);
  const confidence: Confidence = confScore >= 0.72 ? "high" : confScore >= 0.5 ? "medium" : confScore >= 0.3 ? "low" : "insufficient";
  const confidenceNote =
    confidence === "high"
      ? "Most inputs that drive this comparison are confirmed; estimated values affect less than a quarter of the cost base."
      : confidence === "medium"
        ? "Direction is reliable; magnitude depends on benchmark costs for new or changed lanes and facilities."
        : "Treat as indicative. Several high-sensitivity inputs are assumptions; load real quotes and volumes before deciding.";

  const headline = volumeChanged
    ? `${dCases > 0 ? "+" : ""}${fmtPct(dCases, 0)} volume: cost per case ${dCpc >= 0 ? "rises" : "falls"} ${fmtMoney(Math.abs(dCpc), cur, false)}${scenario.constrainedNodes > baseline.constrainedNodes ? `, ${scenario.constrainedNodes - baseline.constrainedNodes} more facilit${scenario.constrainedNodes - baseline.constrainedNodes > 1 ? "ies" : "y"} constrained` : ""}${dSvc < -0.5 ? `, service −${(-dSvc).toFixed(1)} pts` : ""}`
    : dCost < -1000 && dSvc >= -0.1
      ? `Saves ${fmtMoney(-dCost, cur)} a year without hurting service`
      : dCost < -1000
        ? `Saves ${fmtMoney(-dCost, cur)} a year but costs ${(-dSvc).toFixed(1)} service points`
        : dCost > 1000 && dSvc > 0.1
          ? `Costs ${fmtMoney(dCost, cur)} more a year for +${dSvc.toFixed(1)} service points`
          : dCost > 1000
            ? `Costs ${fmtMoney(dCost, cur)} more a year${dRisk < -1 ? ` while reducing risk by ${-dRisk} points` : ""}`
            : "Broadly cost-neutral against the baseline";

  return { rows, costLines, headline, benefits, tradeOffs, limitations, enablers, confidence, confidenceNote, netAnnualDelta: dCost, ...(log.length ? {} : {}) };
}

function inferEnablers(s: Scenario): string[] {
  const e = new Set<string>();
  for (const c of s.changes) {
    if (c.type === "add_node") e.add("Site search, lease or 3PL contract, and a 9–12 month start-up window.");
    if (c.type === "remove_node") e.add("Exit or reassignment of the facility contract; customer communication on new delivery schedules.");
    if (c.type === "direct_to_store") e.add("Carrier capacity for multi-drop chilled routes and revised order cut-offs.");
    if (c.type === "convert_to_cross_dock") e.add("Pre-allocation capability in the NDC WMS and labelled, store-ready pallets.");
    if (c.type === "demand_change") e.add("Confirm the demand forecast with commercial teams before committing capacity.");
    if (c.type === "update_node") e.add("Operational change at the facility (shift pattern, racking, or equipment).");
    if (c.type === "move_channel") e.add("Order management re-routing and FC pick capacity.");
  }
  return [...e];
}

export function evaluateScenario(baseline: NetworkModel, baselineMetrics: NetworkMetrics, scenario: Scenario) {
  const { model, log } = applyScenario(baseline, scenario);
  const metrics = computeMetrics(model);
  const comparison = compareMetrics(baselineMetrics, metrics, baseline, scenario, log);
  return { model, metrics, comparison, log };
}
