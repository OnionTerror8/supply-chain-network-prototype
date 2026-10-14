import { haversineKm, roadKm } from "../domain/geo";
import { scoreToConfidence, sourceWeight } from "../domain/helpers";
import {
  NODE_TYPE_META,
  type CostComponent,
  type CostLine,
  type Lane,
  type LaneMetrics,
  type NetworkMetrics,
  type NetworkModel,
  type NetworkNode,
  type NodeMetrics,
  type Provenance,
  type TransportMode,
} from "../domain/types";

const CUSTOMER_TYPES = new Set(["store", "customer_zone", "wholesaler"]);
const ORIGIN_TYPES = new Set(["farm", "supplier"]);
const STORAGE_TYPES = new Set(["national_dc", "regional_dc", "cold_store", "ecom_fc", "micro_fc", "dark_store", "returns_center"]);

/** Benchmarks used only when a node has no cost data (always flagged as AI estimate). */
const FIXED_COST_BENCHMARK: Partial<Record<NetworkNode["type"], { perCasePerWeek: number; handling: number }>> = {
  factory: { perCasePerWeek: 72, handling: 0.3 },
  copacker: { perCasePerWeek: 55, handling: 0.35 },
  national_dc: { perCasePerWeek: 40, handling: 0.6 },
  regional_dc: { perCasePerWeek: 52, handling: 0.5 },
  cross_dock: { perCasePerWeek: 18, handling: 0.28 },
  cold_store: { perCasePerWeek: 68, handling: 0.7 },
  ecom_fc: { perCasePerWeek: 180, handling: 1.9 },
  micro_fc: { perCasePerWeek: 160, handling: 1.6 },
  dark_store: { perCasePerWeek: 140, handling: 1.4 },
  returns_center: { perCasePerWeek: 90, handling: 3.2 },
  store: { perCasePerWeek: 0, handling: 1.1 },
  wholesaler: { perCasePerWeek: 0, handling: 0 },
  port: { perCasePerWeek: 0, handling: 0.22 },
};

export function laneDistanceKm(model: NetworkModel, lane: Lane): { km: number; source: Provenance } {
  if (lane.distanceKm) return { km: lane.distanceKm.value, source: lane.distanceKm.source };
  const a = model.nodes.find((n) => n.id === lane.from);
  const b = model.nodes.find((n) => n.id === lane.to);
  if (!a || !b) return { km: 0, source: "missing" };
  if (lane.mode === "sea") return { km: haversineKm(a.location, b.location) * 1.35, source: "ai" };
  if (lane.mode === "air") return { km: haversineKm(a.location, b.location) * 1.05, source: "ai" };
  return { km: Math.max(roadKm(a.location, b.location), 8), source: "ai" };
}

function defaultTransit(mode: TransportMode, km: number) {
  const speed: Record<TransportMode, number> = { road: 550, rail: 400, sea: 650, air: 4000, parcel: 450, van: 300 };
  const base: Record<TransportMode, number> = { road: 0.15, rail: 0.8, sea: 4, air: 1.5, parcel: 1, van: 0.4 };
  return base[mode] + km / speed[mode];
}

export function computeMetrics(model: NetworkModel): NetworkMetrics {
  const P = model.parameters;
  const W = P.weeksPerYear;
  const nodeIndex = new Map(model.nodes.map((n) => [n.id, n]));
  const famIndex = new Map(model.productFamilies.map((f) => [f.id, f]));

  const laneMetrics: Record<string, LaneMetrics> = {};
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const inboundLanes = new Map<string, Lane[]>();

  // Evidence accumulation for confidence: weight by annual £ contribution.
  let evidenceWeighted = 0;
  let evidenceTotal = 0;
  const addEvidence = (source: Provenance, weight: number) => {
    evidenceWeighted += sourceWeight(source) * weight;
    evidenceTotal += weight;
  };

  const lines: Record<CostComponent, { annual: number; evidence: number; total: number }> = Object.fromEntries(
    (Object.keys({
      procurement: 0, manufacturing: 0, packaging_handling: 0, warehousing: 0, inventory_carrying: 0, transport: 0,
      last_mile: 0, cross_dock: 0, duties_customs: 0, waste_spoilage: 0, service_failure: 0, carbon: 0,
    }) as CostComponent[]).map((k) => [k, { annual: 0, evidence: 0, total: 0 }]),
  ) as Record<CostComponent, { annual: number; evidence: number; total: number }>;

  const addLine = (c: CostComponent, annual: number, source: Provenance) => {
    lines[c].annual += annual;
    lines[c].evidence += sourceWeight(source) * Math.abs(annual);
    lines[c].total += Math.abs(annual);
    addEvidence(source, Math.abs(annual));
  };

  let emissionsTonnes = 0;

  for (const lane of model.lanes) {
    const vol = lane.volumePerWeek.value;
    const { km } = laneDistanceKm(model, lane);
    const from = nodeIndex.get(lane.from);
    const to = nodeIndex.get(lane.to);
    if (!from || !to) continue;

    let costPerCase: number;
    let costSource: Provenance;
    if (lane.costPerCase) {
      costPerCase = lane.costPerCase.value;
      costSource = lane.costPerCase.source;
    } else {
      const chilledUplift = lane.temperature === "chilled" ? 1.18 : lane.temperature === "frozen" ? 1.25 : 1;
      costPerCase = (P.costPerCaseKm[lane.mode].value * km + P.laneHandlingPerCase.value) * chilledUplift;
      costSource = "ai";
    }
    const annualCost = costPerCase * vol * W;
    const transit = lane.transitDays?.value ?? defaultTransit(lane.mode, km);
    const emissions = (P.emissionsPerCaseKm[lane.mode].value * km * vol * W) / 1000;
    emissionsTonnes += emissions;

    const isLastMile = lane.pattern === "last_mile" || lane.mode === "parcel" || lane.mode === "van";
    addLine(isLastMile ? "last_mile" : "transport", annualCost, costSource);
    addEvidence(lane.volumePerWeek.source, annualCost * 0.5);

    if (lane.crossesBorder) {
      const nonEu = !["NL", "BE", "FR", "DE", "ES", "IT", "PL", "IE", "PT", "DK", "SE", "AT", "CZ", "HU", "GR"].includes(from.location.country);
      const dutyPerCase = nonEu ? 0.95 : 0.22;
      addLine("duties_customs", dutyPerCase * vol * W, "assumed");
    }

    // Procurement: value of goods leaving origin nodes.
    if (ORIGIN_TYPES.has(from.type)) {
      const fams = lane.productFamilies.map((f) => famIndex.get(f)).filter(Boolean);
      const value = fams.length
        ? fams.reduce((s, f) => s + (f!.unitValue?.value ?? P.defaultCaseValue.value), 0) / fams.length
        : P.defaultCaseValue.value;
      const src: Provenance = fams.some((f) => f!.unitValue) ? (fams[0]!.unitValue!.source) : "assumed";
      addLine("procurement", value * vol * W, src);
    }

    // In-transit spoilage exposure for perishable lanes.
    for (const fid of lane.productFamilies) {
      const fam = famIndex.get(fid);
      if (!fam?.shelfLifeDays) continue;
      const share = lane.productFamilies.length ? 1 / lane.productFamilies.length : 1;
      const lifeUsed = transit / fam.shelfLifeDays.value;
      if (lifeUsed > 0.2) {
        const lossRate = Math.min(0.12, (lifeUsed - 0.2) * 0.25);
        addLine("waste_spoilage", lossRate * vol * share * W * (fam.unitValue?.value ?? P.defaultCaseValue.value), "ai");
      }
    }

    inbound.set(lane.to, (inbound.get(lane.to) ?? 0) + vol);
    outbound.set(lane.from, (outbound.get(lane.from) ?? 0) + vol);
    inboundLanes.set(lane.to, [...(inboundLanes.get(lane.to) ?? []), lane]);

    laneMetrics[lane.id] = {
      laneId: lane.id,
      distanceKm: km,
      costPerCase,
      costSource,
      annualCost,
      annualEmissionsTonnes: emissions,
      transitDays: transit,
      shareOfDestinationInbound: 0,
    };
  }
  for (const lane of model.lanes) {
    const lm = laneMetrics[lane.id];
    if (!lm) continue;
    const inb = inbound.get(lane.to) ?? 0;
    lm.shareOfDestinationInbound = inb > 0 ? lane.volumePerWeek.value / inb : 0;
  }

  const nodeMetrics: Record<string, NodeMetrics> = {};
  let inventoryValue = 0;
  let utilSum = 0;
  let utilCount = 0;
  let constrained = 0;
  let unserved = 0;

  for (const node of model.nodes) {
    const inb = inbound.get(node.id) ?? 0;
    const outb = outbound.get(node.id) ?? 0;
    // Production capacity is rated on output; raw-material intake includes yield loss and packaging.
    const isProducer = node.type === "factory" || node.type === "copacker";
    const throughput = isProducer && outb > 0 ? outb : Math.max(inb, outb);
    let annualCost = 0;
    const bench = FIXED_COST_BENCHMARK[node.type];
    const costBucket: CostComponent =
      node.type === "factory" || node.type === "copacker"
        ? "manufacturing"
        : node.type === "cross_dock"
          ? "cross_dock"
          : STORAGE_TYPES.has(node.type)
            ? "warehousing"
            : "packaging_handling";

    if (!ORIGIN_TYPES.has(node.type) && !CUSTOMER_TYPES.has(node.type) || node.type === "store") {
      if (node.fixedCostPerYear) {
        annualCost += node.fixedCostPerYear.value;
        addLine(costBucket, node.fixedCostPerYear.value, node.fixedCostPerYear.source);
      } else if (bench && bench.perCasePerWeek > 0 && throughput > 0) {
        const est = bench.perCasePerWeek * throughput;
        annualCost += est;
        addLine(costBucket, est, "ai");
      }
      const handling = node.handlingCostPerCase?.value ?? bench?.handling ?? 0;
      const hSrc: Provenance = node.handlingCostPerCase?.source ?? "ai";
      if (handling > 0 && throughput > 0) {
        annualCost += handling * throughput * W;
        addLine(costBucket, handling * throughput * W, hSrc);
      }
    }

    // Capacity
    let utilisation: number | undefined;
    if (node.capacityPerWeek && node.capacityPerWeek.value > 0 && throughput > 0) {
      utilisation = throughput / node.capacityPerWeek.value;
      utilSum += utilisation;
      utilCount += 1;
      if (utilisation > P.constrainedUtilisation.value) constrained += 1;
      if (utilisation > 1) unserved += throughput - node.capacityPerWeek.value;
      addEvidence(node.capacityPerWeek.source, throughput * 10);
    }

    // Inventory & spoilage
    let inventoryCases: number | undefined;
    let invValue: number | undefined;
    if (node.inventoryDays && throughput > 0) {
      inventoryCases = (throughput / 7) * node.inventoryDays.value;
      const fams = model.lanes
        .filter((l) => l.to === node.id || l.from === node.id)
        .flatMap((l) => l.productFamilies)
        .map((f) => famIndex.get(f))
        .filter(Boolean);
      const avgValue = fams.length
        ? fams.reduce((s, f) => s + (f!.unitValue?.value ?? P.defaultCaseValue.value), 0) / fams.length
        : P.defaultCaseValue.value;
      invValue = inventoryCases * avgValue;
      inventoryValue += invValue;
      addLine("inventory_carrying", invValue * P.inventoryCarryingRate.value, node.inventoryDays.source === "confirmed" ? "assumed" : node.inventoryDays.source);

      const perishable = fams.filter((f) => f!.weeklyShrinkRate && f!.temperature !== "ambient");
      if (perishable.length) {
        const shrink = perishable.reduce((s, f) => s + f!.weeklyShrinkRate!.value, 0) / perishable.length;
        const share = perishable.length / fams.length;
        const loss = throughput * share * shrink * (node.inventoryDays.value / 7) * W * avgValue;
        addLine("waste_spoilage", loss, perishable[0]!.weeklyShrinkRate!.source);
      }
    }

    const nodeEmissions = STORAGE_TYPES.has(node.type) || node.type === "factory"
      ? (throughput * W * (node.temperature === "ambient" ? 0.09 : node.temperature === "frozen" ? 0.42 : 0.25)) / 1000
      : 0;
    emissionsTonnes += nodeEmissions;

    nodeMetrics[node.id] = {
      nodeId: node.id,
      inboundPerWeek: inb,
      outboundPerWeek: outb,
      throughputPerWeek: throughput,
      utilisation,
      annualCost,
      inventoryCases,
      inventoryValue: invValue,
      emissionsTonnes: nodeEmissions,
      touches: 0,
    };
  }

  // Service: volume-weighted reliability on customer-facing lanes, degraded by capacity shortfall.
  let svcW = 0;
  let svcSum = 0;
  let ltSum = 0;
  let annualCases = 0;
  for (const lane of model.lanes) {
    const to = nodeIndex.get(lane.to);
    const from = nodeIndex.get(lane.from);
    if (!to || !from || !CUSTOMER_TYPES.has(to.type) || lane.pattern === "returns") continue;
    const vol = lane.volumePerWeek.value;
    annualCases += vol * W;
    const rel = lane.reliability?.value ?? 0.92;
    const fromRel = from.reliability?.value ?? 0.94;
    const fromUtil = nodeMetrics[from.id]?.utilisation ?? 0;
    const congestion = fromUtil > P.constrainedUtilisation.value ? (fromUtil - P.constrainedUtilisation.value) * 0.5 : 0;
    // On-time misses convert to case-fill failures only partially (late ≠ lost); facility
    // reliability contributes a smaller share again. Congestion above threshold is additive.
    const svc = Math.max(0.5, 1 - 0.35 * (1 - rel) - 0.3 * (1 - fromRel) - congestion);
    svcSum += svc * vol;
    const lm = laneMetrics[lane.id];
    const upstream = (inboundLanes.get(from.id) ?? []).map((l) => laneMetrics[l.id]?.transitDays ?? 0);
    const upstreamAvg = upstream.length ? upstream.reduce((a, b) => a + b, 0) / upstream.length : 0;
    const stage = from.type === "regional_dc" || from.type === "cross_dock" ? upstreamAvg * 0.5 : 0;
    ltSum += ((lm?.transitDays ?? 1) + stage + 0.5) * vol;
    svcW += vol;
    addLine("service_failure", (1 - svc) * 0.3 * vol * W * P.stockoutCostPerCase.value, lane.reliability ? "assumed" : "ai");
  }
  if (unserved > 0) addLine("service_failure", unserved * W * P.stockoutCostPerCase.value, "assumed");
  const serviceLevel = svcW ? Math.min(0.995, svcSum / svcW) * (1 - Math.min(0.3, unserved / Math.max(1, svcW))) : 0;
  const avgLeadTimeDays = svcW ? ltSum / svcW : 0;

  addLine("carbon", emissionsTonnes * P.carbonPricePerTonne.value, "assumed");

  const costLines: CostLine[] = (Object.keys(lines) as CostComponent[])
    .filter((k) => lines[k].annual > 0)
    .map((k) => {
      const ev = lines[k].total ? lines[k].evidence / lines[k].total : 0;
      const u = 0.04 + 0.45 * (1 - ev);
      return {
        component: k,
        annual: lines[k].annual,
        range: [lines[k].annual * (1 - u), lines[k].annual * (1 + u)],
        confidence: scoreToConfidence(ev, lines[k].total > 0),
        evidenceShare: ev,
        logic: COST_LOGIC[k],
      };
    });

  // Headline network cost excludes the value of purchased goods (reported separately as
  // procurement) and the carbon shadow price, so scenarios are judged on operating cost.
  const cashLines = costLines.filter((l) => l.component !== "carbon" && l.component !== "procurement");
  const procurementAnnual = costLines.find((l) => l.component === "procurement")?.annual ?? 0;
  const totalAnnualCost = cashLines.reduce((s, l) => s + l.annual, 0);
  const costRange: [number, number] = [
    cashLines.reduce((s, l) => s + l.range[0], 0),
    cashLines.reduce((s, l) => s + l.range[1], 0),
  ];

  const confidenceScore = evidenceTotal ? evidenceWeighted / evidenceTotal : 0;

  // Structural risk score (0 = none, 100 = severe).
  let risk = 0;
  const customerVolume = Math.max(1, svcW);
  const totalThroughput = model.nodes.reduce((s, n) => s + (nodeMetrics[n.id]?.throughputPerWeek ?? 0), 0) || 1;
  for (const node of model.nodes) {
    const nm = nodeMetrics[node.id];
    if (!nm) continue;
    const share = nm.throughputPerWeek / totalThroughput;
    if (nm.utilisation && nm.utilisation > P.constrainedUtilisation.value) risk += 120 * share * (nm.utilisation - 0.7);
    const inLanes = inboundLanes.get(node.id) ?? [];
    if (inLanes.length === 1 && !ORIGIN_TYPES.has(node.type) && nm.throughputPerWeek / customerVolume > 0.15) risk += 8;
    if ((node.reliability?.value ?? 1) < 0.9) risk += 6 * Math.min(1, share * 10);
  }
  const borderVol = model.lanes.filter((l) => l.crossesBorder).reduce((s, l) => s + l.volumePerWeek.value, 0);
  risk += Math.min(15, (borderVol / customerVolume) * 25);
  // Gateway concentration: the more import volume relies on one port, the higher the exposure.
  const portThroughput = model.nodes.filter((n) => n.type === "port").map((n) => nodeMetrics[n.id]?.throughputPerWeek ?? 0);
  const portTotal = portThroughput.reduce((a, b) => a + b, 0);
  if (portTotal > 0) risk += 12 * (Math.max(...portThroughput) / portTotal) ** 2 * Math.min(1, portTotal / customerVolume);
  const lowRelVol = model.lanes.filter((l) => (l.reliability?.value ?? 1) < 0.9).reduce((s, l) => s + l.volumePerWeek.value, 0);
  risk += Math.min(15, (lowRelVol / customerVolume) * 20);
  risk += Math.min(10, unserved / customerVolume * 100);
  const riskScore = Math.round(Math.min(100, risk));

  // Resilience rewards redundancy at national/regional tiers and penalises single points of failure.
  const dcNodes = model.nodes.filter((n) => ["national_dc", "regional_dc", "cross_dock", "cold_store"].includes(n.type));
  const factories = model.nodes.filter((n) => ["factory", "copacker"].includes(n.type));
  let resilience = 60;
  resilience += Math.min(15, dcNodes.length * 3);
  resilience += factories.length >= 2 ? 8 : factories.length === 1 ? -8 : 0;
  resilience -= Math.min(30, riskScore * 0.4);
  const headroom = utilCount ? 1 - utilSum / utilCount : 0.3;
  resilience += Math.round(headroom * 20);
  const resilienceScore = Math.round(Math.max(5, Math.min(98, resilience)));

  const totalInvDays = model.nodes.reduce((s, n) => {
    const nm = nodeMetrics[n.id];
    return s + (n.inventoryDays && nm ? n.inventoryDays.value * nm.throughputPerWeek : 0);
  }, 0);
  const invWeight = model.nodes.reduce((s, n) => s + (n.inventoryDays ? nodeMetrics[n.id]?.throughputPerWeek ?? 0 : 0), 0);

  return {
    totalAnnualCost,
    procurementAnnual,
    costRange,
    costPerCase: annualCases ? totalAnnualCost / annualCases : 0,
    annualCases,
    costLines,
    serviceLevel,
    avgLeadTimeDays,
    inventoryValue,
    inventoryDaysWeighted: invWeight ? totalInvDays / invWeight : 0,
    avgUtilisation: utilCount ? utilSum / utilCount : 0,
    constrainedNodes: constrained,
    riskScore,
    resilienceScore,
    emissionsTonnes,
    emissionsPerCaseKg: annualCases ? (emissionsTonnes * 1000) / annualCases : 0,
    dataConfidence: scoreToConfidence(confidenceScore, evidenceTotal > 0),
    confidenceScore,
    nodeMetrics,
    laneMetrics,
    unservedCasesPerWeek: unserved,
  };
}

export const COST_LOGIC: Record<CostComponent, string> = {
  procurement: "Σ (cases leaving farms/suppliers × product family case value × 52). Uses blended family value where unit value is unknown.",
  manufacturing: "Factory fixed cost per year + handling/conversion cost per case × throughput × 52. Benchmarked at £72/case-week when no cost data.",
  packaging_handling: "Store, port and channel handling cost per case × throughput × 52.",
  warehousing: "DC fixed cost per year + handling cost per case × throughput × 52 for national, regional, e-commerce and returns facilities.",
  inventory_carrying: "Σ node inventory days × weekly throughput / 7 × blended case value × carrying rate (18%).",
  transport: "Σ lane cost per case × weekly volume × 52. Lanes without an invoice rate use £/case-km by mode × distance + £0.42 handling per leg.",
  last_mile: "Parcel, van and ship-from-store lanes: cost per case × volume × 52.",
  cross_dock: "Cross-dock fixed and per-case handling cost.",
  duties_customs: "Border-crossing lanes × £0.22 (EU, SPS checks) or £0.95 (non-EU duty + broker) per case. Assumed rates.",
  waste_spoilage: "Perishable throughput × weekly shrink rate × dwell weeks × case value, plus in-transit loss where transit consumes >20% of shelf life.",
  service_failure: "(1 − expected on-time-in-full) × 30% shortfall conversion × volume × stock-out cost per case, plus any capacity-unserved volume.",
  carbon: "Σ lane case-km × DEFRA emission factor by mode + facility energy; priced at the internal shadow carbon price. Reported separately from cash cost.",
};

/** Cost-to-serve: everything downstream of the factory gate (excludes goods and conversion). */
export function costToServe(metrics: NetworkMetrics) {
  return metrics.costLines
    .filter((l) => !["procurement", "manufacturing", "carbon"].includes(l.component))
    .reduce((s, l) => s + l.annual, 0);
}

export function nodeTierLabel(node: NetworkNode) {
  return NODE_TYPE_META[node.type].tier;
}
