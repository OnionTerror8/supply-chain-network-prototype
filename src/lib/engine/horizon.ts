import { cloneModel } from "../domain/helpers";
import type { NetworkModel } from "../domain/types";
import { isFlowLane, rebalanceUpstream, snapshotOutbound } from "./scenarios";

const CUSTOMER_TYPES = new Set(["store", "customer_zone", "wholesaler"]);

/** Peak factor for a demand node. Defaults to 1 when the node is not in a region. */
export function peakFactorForNode(model: NetworkModel, nodeId: string): number {
  const region = model.regions.find((r) => r.nodeIds.includes(nodeId));
  return region?.seasonalityPeakFactor?.value ?? 1;
}

/**
 * View transform: scale customer-facing demand by each region's seasonal peak
 * factor and rebalance upstream. The stored baseline is not mutated.
 */
export function applyHorizon(model: NetworkModel, horizon: "average" | "peak"): NetworkModel {
  if (horizon !== "peak") return model;
  const next = cloneModel(model);
  const before = snapshotOutbound(next);
  const touched = new Set<string>();
  for (const l of next.lanes) {
    if (!isFlowLane(l) || l.pattern === "returns") continue;
    const dest = next.nodes.find((n) => n.id === l.to);
    if (!dest || !CUSTOMER_TYPES.has(dest.type)) continue;
    const factor = peakFactorForNode(next, dest.id);
    if (Math.abs(factor - 1) < 0.005) continue;
    l.volumePerWeek = {
      ...l.volumePerWeek,
      value: Math.round(l.volumePerWeek.value * factor),
      note: [l.volumePerWeek.note, `Peak week ×${factor.toFixed(2)}`].filter(Boolean).join(" · "),
    };
    touched.add(l.from);
  }
  rebalanceUpstream(next, [...touched], before);
  return next;
}
