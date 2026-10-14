import * as XLSX from "xlsx";
import { PROVENANCE_LABEL, COST_COMPONENT_LABEL, type ChangeLogEntry, type Finding, type NetworkMetrics, type NetworkModel, type Scenario, type Tagged } from "../domain/types";
import { costToServe } from "../engine/metrics";
import type { Comparison } from "../engine/scenarios";

const tv = (t?: Tagged<number | string>) => (t ? t.value : "");
const ts = (t?: Tagged<number | string>) => (t ? PROVENANCE_LABEL[t.source] : PROVENANCE_LABEL.missing);

export interface ExportInput {
  model: NetworkModel;
  metrics: NetworkMetrics;
  findings: Finding[];
  scenario?: { scenario: Scenario; model: NetworkModel; metrics: NetworkMetrics; comparison: Comparison };
  changeLog: ChangeLogEntry[];
}

export function buildWorkbook(input: ExportInput) {
  const { model, metrics, findings, scenario, changeLog } = input;
  const wb = XLSX.utils.book_new();

  const summary: (string | number)[][] = [
    ["Meridian network export", model.name],
    ["Generated", new Date().toISOString()],
    ["Currency", model.currency],
    [],
    ["Metric", "Baseline", ...(scenario ? [scenario.scenario.name, "Delta"] : [])],
  ];
  const push = (label: string, b: number, s?: number) => summary.push([label, round(b), ...(scenario && s !== undefined ? [round(s), round(s - b)] : [])]);
  push("Cost-to-serve (annual)", costToServe(metrics), scenario ? costToServe(scenario.metrics) : undefined);
  push("Total network cost (annual)", metrics.totalAnnualCost, scenario?.metrics.totalAnnualCost);
  push("Cost range low", metrics.costRange[0], scenario?.metrics.costRange[0]);
  push("Cost range high", metrics.costRange[1], scenario?.metrics.costRange[1]);
  push("Cost per case", metrics.costPerCase, scenario?.metrics.costPerCase);
  push("Annual cases delivered", metrics.annualCases, scenario?.metrics.annualCases);
  push("Expected service level", metrics.serviceLevel, scenario?.metrics.serviceLevel);
  push("Avg delivery lead time (days)", metrics.avgLeadTimeDays, scenario?.metrics.avgLeadTimeDays);
  push("Inventory value", metrics.inventoryValue, scenario?.metrics.inventoryValue);
  push("Avg facility utilisation", metrics.avgUtilisation, scenario?.metrics.avgUtilisation);
  push("Constrained facilities", metrics.constrainedNodes, scenario?.metrics.constrainedNodes);
  push("Risk score (0-100)", metrics.riskScore, scenario?.metrics.riskScore);
  push("Resilience score (0-100)", metrics.resilienceScore, scenario?.metrics.resilienceScore);
  push("Emissions (tCO2e)", metrics.emissionsTonnes, scenario?.metrics.emissionsTonnes);
  push("Data confidence score", metrics.confidenceScore, scenario?.metrics.confidenceScore);
  summary.push(["Data confidence", metrics.dataConfidence, ...(scenario ? [scenario.metrics.dataConfidence, ""] : [])]);
  if (scenario) {
    summary.push([], ["Scenario headline", scenario.comparison.headline], ["Scenario confidence", scenario.comparison.confidence, scenario.comparison.confidenceNote]);
    summary.push(["Benefits", ...scenario.comparison.benefits]);
    summary.push(["Trade-offs", ...scenario.comparison.tradeOffs]);
    summary.push(["Enablers", ...scenario.comparison.enablers]);
    summary.push(["Limitations", ...scenario.comparison.limitations]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  const cost: (string | number)[][] = [["Cost component", "Baseline annual", "Low", "High", "Confidence", "Evidence share", ...(scenario ? ["Scenario annual", "Delta"] : []), "Calculation logic"]];
  for (const l of metrics.costLines) {
    const s = scenario?.metrics.costLines.find((x) => x.component === l.component)?.annual ?? 0;
    cost.push([COST_COMPONENT_LABEL[l.component], round(l.annual), round(l.range[0]), round(l.range[1]), l.confidence, round(l.evidenceShare, 2), ...(scenario ? [round(s), round(s - l.annual)] : []), l.logic]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cost), "Cost comparison");

  const nodeSheet = (mdl: NetworkModel, met: NetworkMetrics) => [
    ["ID", "Name", "Type", "City", "Region", "Country", "Lat", "Lng", "Location source", "Temperature", "Capacity/wk", "Capacity source", "Throughput/wk", "Utilisation", "Inventory days", "Inventory source", "Fixed cost/yr", "Fixed cost source", "Handling/case", "Handling source", "Reliability", "Reliability source", "Operator", "Annual cost (modelled)", "Emissions tCO2e"],
    ...mdl.nodes.map((n) => {
      const nm = met.nodeMetrics[n.id];
      return [n.id, n.name, n.type, n.location.city ?? "", n.location.region ?? "", n.location.country, n.location.lat, n.location.lng, PROVENANCE_LABEL[n.location.source], n.temperature, tv(n.capacityPerWeek), ts(n.capacityPerWeek), round(nm?.throughputPerWeek ?? 0), nm?.utilisation !== undefined ? round(nm.utilisation, 3) : "", tv(n.inventoryDays), ts(n.inventoryDays), tv(n.fixedCostPerYear), ts(n.fixedCostPerYear), tv(n.handlingCostPerCase), ts(n.handlingCostPerCase), tv(n.reliability), ts(n.reliability), tv(n.operator), round(nm?.annualCost ?? 0), round(nm?.emissionsTonnes ?? 0, 1)];
    }),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(nodeSheet(model, metrics)), "Nodes");

  const laneSheet = (mdl: NetworkModel, met: NetworkMetrics) => [
    ["ID", "From", "To", "Mode", "Temperature", "Product families", "Pattern", "Volume/wk", "Volume source", "Cost/case", "Cost source", "Transit days", "Transit source", "Reliability", "Reliability source", "Distance km", "Crosses border", "Annual cost", "Annual tCO2e"],
    ...mdl.lanes.map((l) => {
      const lm = met.laneMetrics[l.id];
      const nm = (id: string) => mdl.nodes.find((n) => n.id === id)?.name ?? id;
      return [l.id, nm(l.from), nm(l.to), l.mode, l.temperature, l.productFamilies.join(", "), l.pattern ?? "linehaul", l.volumePerWeek.value, PROVENANCE_LABEL[l.volumePerWeek.source], round(lm?.costPerCase ?? 0, 2), PROVENANCE_LABEL[lm?.costSource ?? "missing"], round(lm?.transitDays ?? 0, 1), ts(l.transitDays), tv(l.reliability), ts(l.reliability), round(lm?.distanceKm ?? 0), l.crossesBorder ? "yes" : "no", round(lm?.annualCost ?? 0), round(lm?.annualEmissionsTonnes ?? 0, 1)];
    }),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(laneSheet(model, metrics)), "Lanes");

  if (scenario) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(nodeSheet(scenario.model, scenario.metrics)), "Scenario nodes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(laneSheet(scenario.model, scenario.metrics)), "Scenario lanes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Metric", "Baseline", "Scenario", "Delta", "Delta %", "Better when"], ...scenario.comparison.rows.map((r) => [r.label, round(r.baseline, 3), round(r.scenario, 3), round(r.delta, 3), round(r.deltaPct, 4), r.betterWhen])]), "Scenario comparison");
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Severity", "Category", "Title", "Detected", "Why it matters", "Impacted nodes", "Impacted lanes", "Cost impact (annual)", "Service pts", "Risk delta", "Emissions tCO2e", "Actions", "Trade-offs", "Data used", "Assumptions", "Confidence", "Confidence drivers", "Executive summary"],
      ...findings.map((f) => [f.severity, f.category, f.title, f.detected, f.whyItMatters, f.impacted.nodeIds.map((id) => model.nodes.find((n) => n.id === id)?.name ?? id).join("; "), f.impacted.laneIds.length, f.impact.costAnnual !== undefined ? round(f.impact.costAnnual) : "", f.impact.servicePts ?? "", f.impact.riskDelta ?? "", f.impact.emissionsTonnes !== undefined ? round(f.impact.emissionsTonnes) : "", f.actions.join(" | "), f.tradeOffs.join(" | "), f.dataUsed.join(" | "), f.assumptions.join(" | "), f.confidence, f.confidenceDrivers.map((d) => `${d.effect === "up" ? "+" : "-"} ${d.driver}`).join(" | "), f.executiveSummary]),
    ]),
    "Findings",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Assumption", "Source", "Sensitivity", "Applies to"],
      ...model.assumptions.map((a) => [a.text, PROVENANCE_LABEL[a.source], a.sensitivity, (a.appliesTo ?? []).join(", ")]),
      [],
      ["Operating rule", "Kind", "Active", "Created by"],
      ...model.rules.map((r) => [r.text, r.kind, r.active ? "yes" : "no", r.createdBy]),
      [],
      ["Parameter", "Value", "Source", "Note"],
      ["Inventory carrying rate", model.parameters.inventoryCarryingRate.value, PROVENANCE_LABEL[model.parameters.inventoryCarryingRate.source], model.parameters.inventoryCarryingRate.note ?? ""],
      ["Stock-out cost per case", model.parameters.stockoutCostPerCase.value, PROVENANCE_LABEL[model.parameters.stockoutCostPerCase.source], model.parameters.stockoutCostPerCase.note ?? ""],
      ["Carbon price per tonne", model.parameters.carbonPricePerTonne.value, PROVENANCE_LABEL[model.parameters.carbonPricePerTonne.source], model.parameters.carbonPricePerTonne.note ?? ""],
      ["Constrained utilisation threshold", model.parameters.constrainedUtilisation.value, PROVENANCE_LABEL[model.parameters.constrainedUtilisation.source], ""],
      ...Object.entries(model.parameters.costPerCaseKm).map(([mode, t]) => [`Cost per case-km (${mode})`, t.value, PROVENANCE_LABEL[t.source], t.note ?? ""]),
      ...Object.entries(model.parameters.emissionsPerCaseKm).map(([mode, t]) => [`kgCO2e per case-km (${mode})`, t.value, PROVENANCE_LABEL[t.source], t.note ?? ""]),
    ]),
    "Assumptions & rules",
  );

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["When", "Actor", "Scope", "Summary", "Details"], ...changeLog.map((c) => [c.at, c.actor, c.scope, c.summary, (c.details ?? []).join(" | ")])]), "Change log");

  return wb;
}

export function downloadWorkbook(input: ExportInput) {
  const wb = buildWorkbook(input);
  const safe = input.model.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  XLSX.writeFile(wb, `meridian_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["id", "name", "type", "city", "country", "lat", "lng", "temperature", "capacity_per_week", "inventory_days", "fixed_cost_per_year", "handling_cost_per_case", "reliability", "operator"],
    ["ndc_1", "Example National DC", "national_dc", "Daventry", "GB", 52.2577, -1.1628, "multi", 300000, 4, 11600000, 0.58, 0.95, "3PL"],
    ["c_1", "Example customers", "customer_zone", "London", "GB", 51.5074, -0.1278, "multi", "", "", "", "", "", ""],
  ]), "Nodes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["id", "from", "to", "mode", "temperature", "product_families", "volume_per_week", "cost_per_case", "transit_days", "reliability", "crosses_border", "pattern"],
    ["l_1", "ndc_1", "c_1", "road", "chilled", "ready_meals;salads", 36000, 0.58, 0.3, 0.94, "no", ""],
  ]), "Lanes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["id", "name", "temperature", "velocity", "shelf_life_days", "unit_value", "weekly_shrink_rate"],
    ["ready_meals", "Chilled ready meals", "chilled", "fast", 10, 28.5, 0.012],
  ]), "Product families");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Notes"],
    ["Node types: farm, supplier, port, factory, copacker, national_dc, regional_dc, cross_dock, cold_store, ecom_fc, micro_fc, dark_store, wholesaler, store, customer_zone, returns_center"],
    ["Every numeric field is optional. Values you provide are tagged 'Confirmed source data'. Blank values are estimated and tagged as assumptions."],
    ["Modes: road, rail, sea, air, parcel, van. Temperature: ambient, chilled, frozen, multi."],
  ]), "Read me");
  XLSX.writeFile(wb, "meridian_import_template.xlsx");
}

function round(v: number, d = 0) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
