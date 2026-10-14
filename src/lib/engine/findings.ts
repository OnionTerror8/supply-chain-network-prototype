import { findPlace, placeToLocation } from "../domain/geo";
import { aiEstimate, assumed, fmtMoney, fmtNum, fmtPct } from "../domain/helpers";
import {
  NODE_TYPE_META,
  type Confidence,
  type Finding,
  type Lane,
  type NetworkMetrics,
  type NetworkModel,
  type NetworkNode,
  type Provenance,
  type ScenarioChange,
  type Severity,
} from "../domain/types";

const CUSTOMER_TYPES = new Set(["store", "customer_zone", "wholesaler"]);
const ORIGIN_TYPES = new Set(["farm", "supplier"]);

function confidenceFrom(sources: Provenance[], extraDown: string[] = [], extraUp: string[] = []) {
  const weights: Record<Provenance, number> = { confirmed: 1, user: 0.85, ai: 0.55, assumed: 0.4, missing: 0 };
  const score = sources.length ? sources.reduce((s, p) => s + weights[p], 0) / sources.length : 0;
  const drivers: Finding["confidenceDrivers"] = [];
  const confirmedN = sources.filter((s) => s === "confirmed").length;
  const assumedN = sources.filter((s) => s === "assumed" || s === "ai").length;
  const missingN = sources.filter((s) => s === "missing").length;
  if (confirmedN) drivers.push({ driver: `${confirmedN} of ${sources.length} inputs are confirmed source data`, effect: "up" });
  if (assumedN) drivers.push({ driver: `${assumedN} input${assumedN > 1 ? "s" : ""} rely on defaults or AI estimates`, effect: "down" });
  if (missingN) drivers.push({ driver: `${missingN} required input${missingN > 1 ? "s are" : " is"} missing`, effect: "down" });
  extraDown.forEach((d) => drivers.push({ driver: d, effect: "down" }));
  extraUp.forEach((d) => drivers.push({ driver: d, effect: "up" }));
  const adj = score - extraDown.length * 0.12 + extraUp.length * 0.08;
  const confidence: Confidence = missingN === sources.length && sources.length > 0 ? "insufficient" : adj >= 0.75 ? "high" : adj >= 0.5 ? "medium" : adj >= 0.25 ? "low" : "insufficient";
  return { confidence, drivers };
}

const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function detectFindings(model: NetworkModel, m: NetworkMetrics): Finding[] {
  const out: Finding[] = [];
  const cur = model.currency;
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const fams = new Map(model.productFamilies.map((f) => [f.id, f]));
  const inLanes = (id: string) => model.lanes.filter((l) => l.to === id && l.pattern !== "returns" && l.pattern !== "backhaul");
  const outLanes = (id: string) => model.lanes.filter((l) => l.from === id && l.pattern !== "returns" && l.pattern !== "backhaul");
  const money = (v: number) => fmtMoney(v, cur);
  const W = model.parameters.weeksPerYear;
  const threshold = model.parameters.constrainedUtilisation.value;

  /* ---------------- Capacity bottlenecks ---------------- */
  for (const node of model.nodes) {
    const nm = m.nodeMetrics[node.id];
    if (!nm?.utilisation || !node.capacityPerWeek) continue;
    // Supplier capacity is a sourcing question, handled by the dependency rule below.
    if (ORIGIN_TYPES.has(node.type)) continue;
    const u = nm.utilisation;
    if (u <= threshold - 0.05) continue;
    const region = model.regions.find((r) => r.nodeIds.some((id) => outLanes(node.id).some((l) => l.to === id)));
    const peak = region?.seasonalityPeakFactor?.value ?? 1.3;
    const peakUtil = u * peak;
    const severity: Severity = u > 1 ? "critical" : u > threshold ? "high" : "medium";
    const shortfallPeak = Math.max(0, nm.throughputPerWeek * peak - node.capacityPerWeek.value);
    const weeksAtPeak = 10;
    const costImpact = shortfallPeak * weeksAtPeak * model.parameters.stockoutCostPerCase.value;
    const { confidence, drivers } = confidenceFrom(
      [node.capacityPerWeek.source, ...inLanes(node.id).map((l) => l.volumePerWeek.source)],
      region?.seasonalityPeakFactor?.source === "assumed" ? ["Peak factor is an assumption"] : [],
      node.capacityPerWeek.source === "confirmed" ? ["Capacity comes from a rated capacity study"] : [],
    );
    const downstreamNodes = outLanes(node.id).map((l) => l.to);
    out.push({
      id: `cap_${node.id}`,
      category: "capacity",
      severity,
      title: `${node.name} is running at ${fmtPct(u)} of capacity`,
      detected: `Average weekly throughput of ${fmtNum(nm.throughputPerWeek)} cases against rated capacity of ${fmtNum(node.capacityPerWeek.value)}. At the ${fmtPct(peak - 1)} seasonal peak this reaches ${fmtPct(peakUtil)}${peakUtil > 1 ? `, a shortfall of ~${fmtNum(shortfallPeak)} cases/week` : ""}.`,
      whyItMatters: `Above ${fmtPct(threshold)} utilisation, small disruptions (late inbound, absence, line stoppage) cascade into missed dispatch windows. ${downstreamNodes.length} downstream points depend on this node.`,
      impacted: { nodeIds: [node.id, ...downstreamNodes], laneIds: outLanes(node.id).map((l) => l.id), productFamilyIds: [...new Set(outLanes(node.id).flatMap((l) => l.productFamilies))], period: "Seasonal peak weeks" },
      impact: { costAnnual: costImpact, servicePts: -(peakUtil > 1 ? Math.min(6, (peakUtil - 1) * 20) : 1.2), riskDelta: 8 },
      actions: [
        node.type === "factory" ? "Add a weekend or third shift during peak; qualify a co-packer for one product family." : "Negotiate overflow space or a 3PL pop-up for peak weeks.",
        "Shift slow-moving lines to a less-utilised node to release capacity.",
        region ? `Pull forward build-ahead stock for ${region.name} before peak where shelf life allows.` : "Build ahead where shelf life allows.",
      ],
      tradeOffs: ["Build-ahead increases inventory carrying cost and waste risk for short-life products.", "Overflow 3PL space typically costs 20–35% more per case than contracted capacity."],
      dataUsed: [`Capacity: ${node.capacityPerWeek.note ?? "capacity field"}`, "Weekly lane volumes", region?.seasonalityPeakFactor ? `Seasonal peak factor for ${region.name}` : "Default peak factor"],
      assumptions: [`Peak lasts ~${weeksAtPeak} weeks`, `Shortfall converts to lost sales at ${money(model.parameters.stockoutCostPerCase.value)} per case`],
      confidence,
      confidenceDrivers: drivers,
      suggestedScenario: {
        name: `Relieve ${node.name}`,
        description: `Increase effective capacity at ${node.name} by 15% (additional shift / overflow space).`,
        changes: [{ type: "update_node", nodeId: node.id, patch: { capacityPerWeek: aiEstimate(Math.round(node.capacityPerWeek.value * 1.15), "Scenario: +15% capacity") }, label: "+15% capacity" }],
      },
      executiveSummary: `${node.name} has almost no headroom. In a peak week it ${peakUtil > 1 ? "cannot" : "can barely"} process demand, putting ~${money(costImpact)} of sales and our service promise at risk. We should secure overflow capacity before the next peak.`,
    });
  }

  /* ---------------- Single-source / single-lane dependencies ---------------- */
  for (const node of model.nodes) {
    if (ORIGIN_TYPES.has(node.type) || CUSTOMER_TYPES.has(node.type)) continue;
    const ins = inLanes(node.id);
    if (!ins.length) continue;
    const nm = m.nodeMetrics[node.id];
    const total = ins.reduce((s, l) => s + l.volumePerWeek.value, 0);
    const dominant = [...ins].sort((a, b) => b.volumePerWeek.value - a.volumePerWeek.value)[0];
    const share = dominant.volumePerWeek.value / total;
    if (!(ins.length === 1 || share > 0.7)) continue;
    if (nm.throughputPerWeek < m.annualCases / W * 0.1) continue;
    const src = nodes.get(dominant.from)!;
    const dependentVol = nm.outboundPerWeek;
    const exposure = dependentVol * 2 * model.parameters.stockoutCostPerCase.value;
    const { confidence, drivers } = confidenceFrom([dominant.volumePerWeek.source, dominant.reliability?.source ?? "missing"]);
    out.push({
      id: `dep_${node.id}`,
      category: "dependency",
      severity: share > 0.9 && dependentVol > m.annualCases / W * 0.25 ? "high" : "medium",
      title: `${node.name} depends on a single inbound lane from ${src.name}`,
      detected: `${fmtPct(share)} of ${node.name}'s inbound volume (${fmtNum(dominant.volumePerWeek.value)} cases/week) arrives on one lane${dominant.crossesBorder ? " that crosses a border" : ""}. Lane reliability is ${dominant.reliability ? fmtPct(dominant.reliability.value) : "not recorded"}.`,
      whyItMatters: `A two-week outage of that lane would strand ~${fmtNum(dependentVol * 2)} cases of downstream demand with no modelled alternative.`,
      impacted: { nodeIds: [node.id, src.id], laneIds: [dominant.id], productFamilyIds: dominant.productFamilies },
      impact: { costAnnual: exposure * 0.1, riskDelta: 10 },
      actions: ["Qualify a secondary source or alternate routing for at least 30% of volume.", "Hold strategic safety stock downstream for the top product families.", "Agree a contingency carrier / mode (e.g., rail or alternate port)."],
      tradeOffs: ["Dual sourcing can add 3–6% to unit cost through lost volume discounts.", "Safety stock raises carrying cost and, for perishables, waste."],
      dataUsed: ["Inbound lane structure", "Weekly lane volumes", dominant.reliability ? "Lane reliability" : "No reliability data"],
      assumptions: ["Outage of two weeks used for exposure sizing", "10% annual probability of a material disruption"],
      confidence,
      confidenceDrivers: drivers,
      suggestedScenario: { name: `Lose ${src.name}`, description: `Stress test: remove ${src.name} and reassign its volume.`, changes: [{ type: "remove_node", nodeId: src.id, reassign: true }] },
      executiveSummary: `${node.name} relies almost entirely on one supply lane. If it fails we have no fallback; a two-week loss would cost around ${money(exposure)} in missed sales. A second source is the cheapest insurance available.`,
    });
  }

  /* ---------------- Supplier / carrier reliability ---------------- */
  for (const lane of model.lanes) {
    if (!lane.reliability || lane.reliability.value >= 0.9) continue;
    const from = nodes.get(lane.from)!;
    const to = nodes.get(lane.to)!;
    const lateVol = lane.volumePerWeek.value * (1 - lane.reliability.value);
    const cost = lateVol * W * 0.3 * model.parameters.stockoutCostPerCase.value;
    const { confidence, drivers } = confidenceFrom([lane.reliability.source, lane.volumePerWeek.source]);
    out.push({
      id: `rel_${lane.id}`,
      category: "reliability",
      severity: lane.reliability.value < 0.85 ? "high" : "medium",
      title: `${from.name} → ${to.name} is only ${fmtPct(lane.reliability.value)} on time`,
      detected: `${fmtNum(lateVol)} cases/week arrive late on this ${lane.mode} lane${lane.crossesBorder ? " (border crossing)" : ""}, transit ${lane.transitDays?.value ?? "?"} days.`,
      whyItMatters: `Late inbound forces re-planning at ${to.name} and erodes shelf life for perishable lines.`,
      impacted: { nodeIds: [from.id, to.id], laneIds: [lane.id], productFamilyIds: lane.productFamilies },
      impact: { costAnnual: cost, servicePts: -0.8 },
      actions: ["Introduce a carrier scorecard with penalty / bonus on OTIF.", lane.crossesBorder ? "Pre-lodge customs declarations and use a trusted-trader lane." : "Tighten booking windows and add a buffer slot.", "Add a one-day buffer at the destination for this lane only."],
      tradeOffs: ["Buffers add dwell time and reduce shelf life at the customer."],
      dataUsed: [lane.reliability.note ?? "Lane reliability", "Weekly volume"],
      assumptions: ["30% of late deliveries cause a customer shortfall"],
      confidence,
      confidenceDrivers: drivers,
      executiveSummary: `One of our inbound lanes misses its slot one time in ${Math.round(1 / (1 - lane.reliability.value))}. That is worth ~${money(cost)} a year in service cost and avoidable firefighting.`,
    });
  }

  /* ---------------- Shelf-life / cold-chain exposure ---------------- */
  for (const lane of model.lanes) {
    const lm = m.laneMetrics[lane.id];
    if (!lm) continue;
    for (const fid of lane.productFamilies) {
      const fam = fams.get(fid);
      if (!fam?.shelfLifeDays || fam.temperature === "ambient") continue;
      const used = lm.transitDays / fam.shelfLifeDays.value;
      if (used < 0.25) continue;
      const from = nodes.get(lane.from)!;
      const to = nodes.get(lane.to)!;
      const loss = Math.min(0.12, (used - 0.2) * 0.25) * lane.volumePerWeek.value * W * (fam.unitValue?.value ?? 20) / lane.productFamilies.length;
      const { confidence, drivers } = confidenceFrom([lane.transitDays?.source ?? "ai", fam.shelfLifeDays.source, lane.volumePerWeek.source]);
      out.push({
        id: `shelf_${lane.id}_${fid}`,
        category: "food_safety",
        severity: used > 0.4 ? "high" : "medium",
        title: `${fam.name} lose ${fmtPct(used)} of shelf life on ${from.name} → ${to.name}`,
        detected: `Transit of ${lm.transitDays.toFixed(1)} days against a ${fam.shelfLifeDays.value}-day shelf life, before any dwell at ${to.name}.`,
        whyItMatters: `Retailers typically require 75% life on receipt. This lane leaves little margin for a delay, and any temperature excursion means rejection of the whole load.`,
        impacted: { nodeIds: [from.id, to.id], laneIds: [lane.id], productFamilyIds: [fid] },
        impact: { costAnnual: loss, riskDelta: 5 },
        actions: ["Move this flow to a faster mode or a closer source during the season.", "Add temperature logging with exception alerts on this lane.", "Review order cut-offs so product is not aged before dispatch."],
        tradeOffs: ["Faster or nearer supply usually carries a unit-cost premium."],
        dataUsed: ["Lane transit time", `Shelf life for ${fam.name}`],
        assumptions: ["Loss rate rises 25% for every 10% of life consumed beyond 20%"],
        confidence,
        confidenceDrivers: drivers,
        executiveSummary: `Our ${fam.name.toLowerCase()} spend too long in transit from ${from.location.city ?? from.name}. That is a food-waste and customer-rejection risk worth ~${money(loss)} a year.`,
      });
    }
  }

  /* ---------------- High-cost lanes ---------------- */
  const laneCosts = model.lanes
    .filter((l) => l.pattern !== "returns" && l.pattern !== "backhaul" && l.mode !== "parcel" && l.mode !== "van")
    .map((l) => ({ lane: l, lm: m.laneMetrics[l.id] }))
    .filter((x) => x.lm && x.lm.distanceKm > 20)
    .map((x) => ({ ...x, perKm: x.lm.costPerCase / x.lm.distanceKm }));
  if (laneCosts.length > 3) {
    const median = [...laneCosts].sort((a, b) => a.perKm - b.perKm)[Math.floor(laneCosts.length / 2)].perKm;
    for (const x of laneCosts.filter((x) => x.perKm > median * 1.8 && x.lm.annualCost > m.totalAnnualCost * 0.004)) {
      const from = nodes.get(x.lane.from)!;
      const to = nodes.get(x.lane.to)!;
      const saving = (x.perKm - median * 1.2) * x.lm.distanceKm * x.lane.volumePerWeek.value * W;
      const { confidence, drivers } = confidenceFrom([x.lm.costSource, x.lane.volumePerWeek.source]);
      out.push({
        id: `cost_${x.lane.id}`,
        category: "cost",
        severity: saving > m.totalAnnualCost * 0.01 ? "high" : "medium",
        title: `${from.name} → ${to.name} costs ${(x.perKm / median).toFixed(1)}× the network median per case-km`,
        detected: `${money(x.lm.costPerCase)} per case over ${Math.round(x.lm.distanceKm)} km (${money(x.lm.annualCost)} a year). ${x.lane.costPerCase?.note ?? ""}`,
        whyItMatters: `Part-loads, poor backhaul or an uncompetitive rate card are usually behind outliers this large.`,
        impacted: { nodeIds: [from.id, to.id], laneIds: [x.lane.id], productFamilyIds: x.lane.productFamilies },
        impact: { costAnnual: -saving },
        actions: ["Consolidate with neighbouring deliveries or move to a pool-distribution partner.", "Tender the lane; benchmark against the network median.", "Pair with a backhaul to improve asset utilisation."],
        tradeOffs: ["Consolidation can lengthen lead time by up to a day."],
        dataUsed: ["Lane cost per case", "Computed road distance"],
        assumptions: ["A realistic target is 1.2× the network median per case-km"],
        confidence,
        confidenceDrivers: drivers,
        executiveSummary: `One route to ${to.location.city ?? to.name} costs nearly double our norm. Re-tendering or consolidating it is worth ~${money(saving)} a year with no service impact.`,
      });
    }
  }

  /* ---------------- Under-utilised assets ---------------- */
  for (const node of model.nodes) {
    const nm = m.nodeMetrics[node.id];
    if (!nm?.utilisation || nm.utilisation > 0.45 || !node.fixedCostPerYear) continue;
    if (!["regional_dc", "national_dc", "cross_dock", "cold_store", "ecom_fc"].includes(node.type)) continue;
    const idleCost = node.fixedCostPerYear.value * (1 - nm.utilisation / 0.8);
    const alternatives = model.nodes.filter((n) => n.id !== node.id && n.type === node.type);
    const { confidence, drivers } = confidenceFrom([node.fixedCostPerYear.source, node.capacityPerWeek!.source]);
    out.push({
      id: `under_${node.id}`,
      category: "efficiency",
      severity: idleCost > m.totalAnnualCost * 0.01 ? "medium" : "low",
      title: `${node.name} is only ${fmtPct(nm.utilisation)} utilised`,
      detected: `${fmtNum(nm.throughputPerWeek)} cases/week through a ${fmtNum(node.capacityPerWeek!.value)}-case facility costing ${money(node.fixedCostPerYear.value)} a year.`,
      whyItMatters: `Fixed cost is spread over too few cases: ${money(node.fixedCostPerYear.value / (nm.throughputPerWeek * W))} per case versus a typical ${money(0.9)}–${money(1.4)}.`,
      impacted: { nodeIds: [node.id], laneIds: outLanes(node.id).map((l) => l.id), productFamilyIds: [] },
      impact: { costAnnual: -idleCost * 0.6 },
      actions: [alternatives.length ? `Consolidate into ${alternatives[0].name} and serve the catchment direct.` : "Serve the catchment direct from the national DC.", "Sub-let surplus space or convert to a cross-dock.", "Move e-commerce or returns processing here to fill capacity."],
      tradeOffs: ["Closing lengthens stem distance and may raise transport cost and emissions.", "Lease exit costs may apply."],
      dataUsed: ["Fixed cost per year", "Capacity and weekly throughput"],
      assumptions: ["60% of idle fixed cost is recoverable"],
      confidence,
      confidenceDrivers: drivers,
      suggestedScenario: { name: `Close ${node.name}`, description: `Remove ${node.name} and reassign its deliveries to the nearest alternative.`, changes: [{ type: "remove_node", nodeId: node.id, reassign: true }] },
      executiveSummary: `${node.name} is less than half full. We are paying for space we do not use; closing or repurposing it could save ~${money(idleCost * 0.6)} a year, at the cost of slightly longer delivery distances.`,
    });
  }

  /* ---------------- Excess handling / network complexity ---------------- */
  {
    const customerNodes = model.nodes.filter((n) => CUSTOMER_TYPES.has(n.type));
    const touches = (id: string, depth = 0): number => {
      if (depth > 8) return depth;
      const ins = inLanes(id);
      if (!ins.length) return 0;
      const dominant = [...ins].sort((a, b) => b.volumePerWeek.value - a.volumePerWeek.value)[0];
      return 1 + touches(dominant.from, depth + 1);
    };
    const deep = customerNodes.map((n) => ({ n, t: touches(n.id) })).filter((x) => x.t >= 5);
    if (deep.length) {
      const laneIds = deep.flatMap((d) => inLanes(d.n.id).map((l) => l.id));
      const vol = deep.reduce((s, d) => s + inLanes(d.n.id).reduce((a, l) => a + l.volumePerWeek.value, 0), 0);
      const saving = vol * W * model.parameters.laneHandlingPerCase.value;
      out.push({
        id: "complexity_touches",
        category: "efficiency",
        severity: "medium",
        title: `${deep.length} customer point${deep.length > 1 ? "s" : ""} receive product after 5+ handling steps`,
        detected: `Dominant paths to ${deep.map((d) => d.n.name).slice(0, 3).join(", ")}${deep.length > 3 ? "…" : ""} pass through ${Math.max(...deep.map((d) => d.t))} nodes from origin.`,
        whyItMatters: `Every touch adds ~${money(model.parameters.laneHandlingPerCase.value)}/case, a day of lead time and a damage/temperature risk.`,
        impacted: { nodeIds: deep.map((d) => d.n.id), laneIds, productFamilyIds: [] },
        impact: { costAnnual: -saving, servicePts: 0.5 },
        actions: ["Bypass the regional tier for fast-moving lines (direct from NDC or factory).", "Cross-dock instead of put-away at the regional tier."],
        tradeOffs: ["Direct flows need full-load volumes to stay cost-neutral."],
        dataUsed: ["Network structure", "Lane volumes"],
        assumptions: ["One handling step removable per path"],
        confidence: "medium",
        confidenceDrivers: [{ driver: "Based on confirmed network structure", effect: "up" }, { driver: "Handling cost per touch is a benchmark", effect: "down" }],
        executiveSummary: `Some products are handled five or more times before they reach the customer. Removing one step is worth ~${money(saving)} a year and a day of freshness.`,
      });
    }
  }

  /* ---------------- Geographic / border concentration ---------------- */
  {
    const ports = model.nodes.filter((n) => n.type === "port");
    for (const port of ports) {
      const nm = m.nodeMetrics[port.id];
      const weekly = m.annualCases / W;
      if (!nm || nm.throughputPerWeek < weekly * 0.2) continue;
      const { confidence, drivers } = confidenceFrom([port.reliability?.source ?? "missing", ...inLanes(port.id).map((l) => l.volumePerWeek.source)]);
      out.push({
        id: `geo_${port.id}`,
        category: "geographic",
        severity: nm.throughputPerWeek > weekly * 0.35 ? "high" : "medium",
        title: `${fmtPct(nm.throughputPerWeek / weekly)} of inbound volume funnels through ${port.name}`,
        detected: `${fmtNum(nm.throughputPerWeek)} cases/week cross at one gateway${port.reliability ? ` with ${fmtPct(port.reliability.value)} on-time clearance` : ""}.`,
        whyItMatters: "Strikes, weather, IT outages and new border controls hit a single point. Dwell time directly erodes shelf life for chilled imports.",
        impacted: { nodeIds: [port.id, ...inLanes(port.id).map((l) => l.from)], laneIds: [...inLanes(port.id), ...outLanes(port.id)].map((l) => l.id), productFamilyIds: [...new Set(inLanes(port.id).flatMap((l) => l.productFamilies))] },
        impact: { riskDelta: 9 },
        actions: ["Qualify an alternative gateway for 20–30% of volume.", "Pre-clear customs and hold a 3-day buffer for the most exposed families.", "Map UK-season alternatives for imported produce."],
        tradeOffs: ["Alternative gateways may be further from the receiving site."],
        dataUsed: ["Lane structure", "Port reliability"],
        assumptions: ["A single gateway outage of 3+ days occurs roughly once a year"],
        confidence,
        confidenceDrivers: drivers,
        suggestedScenario: { name: `Lose ${port.name}`, description: `Stress test: ${port.name} unavailable, volume reassigned where possible.`, changes: [{ type: "remove_node", nodeId: port.id, reassign: true }] },
        executiveSummary: `A large share of our supply comes through ${port.name}. A disruption there would stop production within days. We should set up an alternative route for part of the volume.`,
      });
    }
  }

  /* ---------------- Carbon hotspots ---------------- */
  {
    const sorted = Object.values(m.laneMetrics).sort((a, b) => b.annualEmissionsTonnes - a.annualEmissionsTonnes);
    const top = sorted[0];
    if (top && m.emissionsTonnes > 0 && top.annualEmissionsTonnes / m.emissionsTonnes > 0.12) {
      const lane = model.lanes.find((l) => l.id === top.laneId)!;
      const from = nodes.get(lane.from)!;
      const to = nodes.get(lane.to)!;
      const railSaving = lane.mode === "road" ? top.annualEmissionsTonnes * 0.7 : lane.mode === "air" ? top.annualEmissionsTonnes * 0.9 : top.annualEmissionsTonnes * 0.15;
      out.push({
        id: `carbon_${lane.id}`,
        category: "carbon",
        severity: "medium",
        title: `${from.name} → ${to.name} is the largest carbon hotspot (${fmtPct(top.annualEmissionsTonnes / m.emissionsTonnes)} of network emissions)`,
        detected: `${fmtNum(top.annualEmissionsTonnes)} tCO2e a year from ${fmtNum(lane.volumePerWeek.value)} cases/week over ${Math.round(top.distanceKm)} km by ${lane.mode}.`,
        whyItMatters: `Customers increasingly score suppliers on Scope 3. At the ${money(model.parameters.carbonPricePerTonne.value)}/t shadow price this lane carries ${money(top.annualEmissionsTonnes * model.parameters.carbonPricePerTonne.value)} of carbon cost.`,
        impacted: { nodeIds: [from.id, to.id], laneIds: [lane.id], productFamilyIds: lane.productFamilies },
        impact: { emissionsTonnes: -railSaving },
        actions: [lane.mode === "road" ? "Trial intermodal rail for this lane (−70% emissions)." : "Shift mode or source closer to demand.", "Specify HVO or electric tractors with the carrier.", "Increase load fill with returnable packaging and backhauls."],
        tradeOffs: ["Rail adds 0.5–1 day of transit and terminal handling.", "HVO carries a 5–10% rate premium."],
        dataUsed: ["Lane distance and mode", "DEFRA emission factors"],
        assumptions: ["Emission factors are fleet averages, not carrier-specific"],
        confidence: "medium",
        confidenceDrivers: [{ driver: "Distance and volume are reliable", effect: "up" }, { driver: "Emission factors are generic averages", effect: "down" }],
        executiveSummary: `One route accounts for a large share of our transport emissions. Moving it to rail or cleaner fuel would cut ~${fmtNum(railSaving)} tonnes of CO2e a year, a visible sustainability win.`,
      });
    }
  }

  /* ---------------- Data quality ---------------- */
  {
    const missing: { what: string; nodeIds: string[]; laneIds: string[] }[] = [];
    const noCap = model.nodes.filter((n) => ["factory", "national_dc", "regional_dc", "cross_dock", "ecom_fc", "cold_store"].includes(n.type) && !n.capacityPerWeek);
    if (noCap.length) missing.push({ what: `capacity for ${noCap.map((n) => n.name).join(", ")}`, nodeIds: noCap.map((n) => n.id), laneIds: [] });
    const noCost = model.lanes.filter((l) => !l.costPerCase);
    if (noCost.length) missing.push({ what: `cost on ${noCost.length} lane${noCost.length > 1 ? "s" : ""} (estimated from distance)`, nodeIds: [], laneIds: noCost.map((l) => l.id) });
    const noRel = model.lanes.filter((l) => !l.reliability && l.pattern !== "returns" && l.pattern !== "backhaul");
    if (noRel.length) missing.push({ what: `reliability on ${noRel.length} lane${noRel.length > 1 ? "s" : ""}`, nodeIds: [], laneIds: noRel.map((l) => l.id) });
    const assumedVol = model.lanes.filter((l) => l.volumePerWeek.source === "assumed" || l.volumePerWeek.source === "ai");
    if (assumedVol.length) missing.push({ what: `volumes on ${assumedVol.length} lane${assumedVol.length > 1 ? "s" : ""} are assumed`, nodeIds: [], laneIds: assumedVol.map((l) => l.id) });
    const noFixed = model.nodes.filter((n) => ["regional_dc", "national_dc", "factory"].includes(n.type) && n.fixedCostPerYear && n.fixedCostPerYear.source !== "confirmed");
    if (noFixed.length) missing.push({ what: `fixed cost for ${noFixed.map((n) => n.name).join(", ")} is not from a cost centre`, nodeIds: noFixed.map((n) => n.id), laneIds: [] });
    if (missing.length) {
      const biggest = noCost.length ? "Load the carrier rate card or last quarter's freight invoices for the unpriced lanes." : noCap.length ? "Enter rated capacity for the facilities missing it." : "Load OTIF data from the TMS for the unmeasured lanes.";
      out.push({
        id: "data_quality",
        category: "data_quality",
        severity: m.confidenceScore < 0.6 ? "high" : "low",
        title: `Data gaps limit confidence to ${m.dataConfidence} (${fmtPct(m.confidenceScore)} evidence-weighted)`,
        detected: `Missing or assumed: ${missing.map((x) => x.what).join("; ")}.`,
        whyItMatters: "Recommendations that depend on these values carry wider ranges. Closing the biggest gap first tightens every downstream number.",
        impacted: { nodeIds: [...new Set(missing.flatMap((x) => x.nodeIds))], laneIds: [...new Set(missing.flatMap((x) => x.laneIds))], productFamilyIds: [] },
        impact: {},
        actions: [biggest, "Connect the WMS for live throughput and inventory days.", "Confirm seasonal peak factors from last year's weekly demand."],
        tradeOffs: [],
        dataUsed: ["Field provenance tags across nodes and lanes"],
        assumptions: [],
        confidence: "high",
        confidenceDrivers: [{ driver: "Provenance tags are deterministic", effect: "up" }],
        executiveSummary: `Our numbers are directionally right but ${missing.length} data gaps widen the ranges. The single most valuable next input: ${biggest.toLowerCase()}`,
      });
    }
  }

  /* ---------------- Opportunity: regional gap (long direct lanes) ---------------- */
  {
    const nd = model.nodes.filter((n) => n.type === "national_dc");
    for (const n of nd) {
      const direct = outLanes(n.id).filter((l) => {
        const to = nodes.get(l.to);
        return to && CUSTOMER_TYPES.has(to.type) && (m.laneMetrics[l.id]?.distanceKm ?? 0) > 150;
      });
      const vol = direct.reduce((s, l) => s + l.volumePerWeek.value, 0);
      if (direct.length < 2 || vol < m.annualCases / W * 0.06) continue;
      const cost = direct.reduce((s, l) => s + (m.laneMetrics[l.id]?.annualCost ?? 0), 0);
      const regions = [...new Set(direct.map((l) => nodes.get(l.to)?.location.region).filter(Boolean))];
      const centroidCity = regions.includes("Midlands") ? "Birmingham" : regions.includes("North East") ? "Leeds" : regions[0] ?? "Birmingham";
      const place = findPlace(centroidCity);
      const changes: ScenarioChange[] = place
        ? [{
            type: "add_node",
            node: {
              id: `rdc_${centroidCity.toLowerCase().replace(/\s+/g, "_")}_new`,
              name: `${centroidCity} RDC (proposed)`,
              type: "regional_dc",
              temperature: "chilled",
              location: placeToLocation(place, "ai"),
              capacityPerWeek: assumed(Math.round(vol * 1.4 / 1000) * 1000, "Sized at 70% utilisation of reassigned volume"),
              inventoryDays: assumed(2.5, "Typical RDC"),
              fixedCostPerYear: assumed(Math.round(vol * 52 * 1.1), "£1.10 per case benchmark"),
              handlingCostPerCase: assumed(0.5),
              reliability: assumed(0.94),
              operator: assumed("3PL"),
            },
            serveNearest: ["store", "customer_zone"],
            feedFrom: n.id,
          }]
        : [];
      out.push({
        id: `opp_regional_${n.id}`,
        category: "opportunity",
        severity: "info",
        title: `${direct.length} long direct lanes from ${n.name} could be served by a regional hub`,
        detected: `${fmtNum(vol)} cases/week travel over 150 km direct to customers in ${regions.join(", ")}, costing ${money(cost)} a year.`,
        whyItMatters: "A regional hub converts many part-loads into full trunk loads plus short local deliveries, typically cutting cost and lead time together.",
        impacted: { nodeIds: [n.id, ...direct.map((l) => l.to)], laneIds: direct.map((l) => l.id), productFamilyIds: [] },
        impact: { costAnnual: -cost * 0.12, servicePts: 0.6 },
        actions: [`Model a regional DC near ${centroidCity} serving these customers.`, "Alternatively test a cross-dock operated by the current carrier."],
        tradeOffs: ["Adds a fixed-cost site and one handling step; benefits depend on securing full trunk loads."],
        dataUsed: ["Direct lane distances and costs"],
        assumptions: ["12% net saving after new site costs, consistent with similar UK network studies"],
        confidence: "low",
        confidenceDrivers: [{ driver: "Site cost is a benchmark until a quote is obtained", effect: "down" }, { driver: "Lane volumes are confirmed", effect: "up" }],
        suggestedScenario: changes.length ? { name: `Add ${centroidCity} RDC`, description: `Add a regional DC in ${centroidCity} fed from ${n.name}, serving the nearest customers.`, changes } : undefined,
        executiveSummary: `We send many long direct deliveries from ${n.name}. A regional hub in ${centroidCity} could trim ~${money(cost * 0.12)} a year and improve delivery times, subject to a site quote.`,
      });
    }
  }

  return out.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || Math.abs(b.impact.costAnnual ?? 0) - Math.abs(a.impact.costAnnual ?? 0));
}

export function describeNodeType(node: NetworkNode) {
  return NODE_TYPE_META[node.type].label;
}

export function laneLabel(model: NetworkModel, lane: Lane) {
  const f = model.nodes.find((n) => n.id === lane.from)?.name ?? lane.from;
  const t = model.nodes.find((n) => n.id === lane.to)?.name ?? lane.to;
  return `${f} → ${t}`;
}
