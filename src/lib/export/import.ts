import * as XLSX from "xlsx";
import { confirmed, defaultParameters, uid } from "../domain/helpers";
import type { Lane, NetworkModel, NetworkNode, NodeType, ProductFamily, Temperature, TransportMode } from "../domain/types";
import { isJsonNetworkFile, parseNetworkJson } from "./json";

type Row = Record<string, string | number | undefined>;

const num = (v: string | number | undefined) => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};
const str = (v: string | number | undefined) => (v === undefined ? undefined : String(v).trim());

/** Spreadsheet or tagged JSON. JSON preserves provenance; Excel marks provided cells as confirmed. */
export async function importNetworkFile(file: File): Promise<{ model: NetworkModel; warnings: string[] }> {
  if (isJsonNetworkFile(file)) {
    const model = parseNetworkJson(JSON.parse(await file.text()));
    return { model, warnings: ["Imported tagged JSON. Provenance on each field is preserved."] };
  }
  return importWorkbook(file);
}

/** Parse a workbook created from the Meridian template. Provided values are tagged as confirmed. */
export async function importWorkbook(file: File): Promise<{ model: NetworkModel; warnings: string[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const warnings: string[] = [];
  const sheet = (name: string) => {
    const ws = wb.Sheets[name] ?? wb.Sheets[Object.keys(wb.Sheets).find((k) => k.toLowerCase().startsWith(name.toLowerCase())) ?? ""];
    return ws ? (XLSX.utils.sheet_to_json(ws, { defval: "" }) as Row[]) : [];
  };
  const nodeRows = sheet("Nodes");
  const laneRows = sheet("Lanes");
  const famRows = sheet("Product families");
  if (!nodeRows.length) throw new Error("No 'Nodes' sheet found. Download the template to see the expected layout.");

  const nodes: NetworkNode[] = nodeRows
    .filter((r) => str(r.name))
    .map((r, i) => {
      const lat = num(r.lat);
      const lng = num(r.lng);
      if (lat === undefined || lng === undefined) warnings.push(`Row ${i + 2} (${r.name}) has no coordinates; placed at 0,0.`);
      const cap = num(r.capacity_per_week);
      const inv = num(r.inventory_days);
      const fixed = num(r.fixed_cost_per_year);
      const hand = num(r.handling_cost_per_case);
      const rel = num(r.reliability);
      return {
        id: str(r.id) || uid("node"),
        name: str(r.name)!,
        type: (str(r.type) as NodeType) || "customer_zone",
        temperature: ((str(r.temperature) as Temperature) || "ambient"),
        location: { lat: lat ?? 0, lng: lng ?? 0, city: str(r.city), country: str(r.country) || "GB", source: "confirmed" },
        ...(cap !== undefined ? { capacityPerWeek: confirmed(cap, "Imported") } : {}),
        ...(inv !== undefined ? { inventoryDays: confirmed(inv, "Imported") } : {}),
        ...(fixed !== undefined ? { fixedCostPerYear: confirmed(fixed, "Imported") } : {}),
        ...(hand !== undefined ? { handlingCostPerCase: confirmed(hand, "Imported") } : {}),
        ...(rel !== undefined ? { reliability: confirmed(rel, "Imported") } : {}),
        ...(str(r.operator) ? { operator: confirmed(str(r.operator)!) } : {}),
      } satisfies NetworkNode;
    });
  const ids = new Set(nodes.map((n) => n.id));
  const lanes: Lane[] = laneRows
    .filter((r) => str(r.from) && str(r.to))
    .flatMap((r, i) => {
      if (!ids.has(str(r.from)!) || !ids.has(str(r.to)!)) {
        warnings.push(`Lane row ${i + 2} references an unknown node (${r.from} → ${r.to}); skipped.`);
        return [];
      }
      const vol = num(r.volume_per_week);
      const cost = num(r.cost_per_case);
      const transit = num(r.transit_days);
      const rel = num(r.reliability);
      return [{
        id: str(r.id) || uid("lane"),
        from: str(r.from)!,
        to: str(r.to)!,
        mode: ((str(r.mode) as TransportMode) || "road"),
        temperature: ((str(r.temperature) as Temperature) || "ambient"),
        productFamilies: (str(r.product_families) ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean),
        volumePerWeek: vol !== undefined ? confirmed(vol, "Imported") : { value: 0, source: "missing" as const },
        ...(cost !== undefined ? { costPerCase: confirmed(cost, "Imported") } : {}),
        ...(transit !== undefined ? { transitDays: confirmed(transit, "Imported") } : {}),
        ...(rel !== undefined ? { reliability: confirmed(rel, "Imported") } : {}),
        crossesBorder: /^(y|yes|true|1)$/i.test(str(r.crosses_border) ?? ""),
        ...(str(r.pattern) ? { pattern: str(r.pattern) as Lane["pattern"] } : {}),
      } satisfies Lane];
    });
  const productFamilies: ProductFamily[] = famRows.filter((r) => str(r.name)).map((r) => ({
    id: str(r.id) || uid("fam"),
    name: str(r.name)!,
    temperature: ((str(r.temperature) as Temperature) || "ambient"),
    velocity: ((str(r.velocity) as ProductFamily["velocity"]) || "medium"),
    ...(num(r.shelf_life_days) !== undefined ? { shelfLifeDays: confirmed(num(r.shelf_life_days)!) } : {}),
    ...(num(r.unit_value) !== undefined ? { unitValue: confirmed(num(r.unit_value)!) } : {}),
    ...(num(r.weekly_shrink_rate) !== undefined ? { weeklyShrinkRate: confirmed(num(r.weekly_shrink_rate)!) } : {}),
  }));
  const regions = [...new Set(nodes.filter((n) => ["store", "customer_zone"].includes(n.type)).map((n) => n.location.city ?? "Other"))].map((c) => ({ id: `r_${c.toLowerCase().replace(/\s+/g, "_")}`, name: c, nodeIds: nodes.filter((n) => n.location.city === c && ["store", "customer_zone"].includes(n.type)).map((n) => n.id) }));
  return {
    model: {
      id: uid("model"),
      name: file.name.replace(/\.[^.]+$/, ""),
      vertical: "generic",
      currency: "GBP",
      description: `Imported from ${file.name}`,
      nodes,
      lanes,
      productFamilies,
      regions,
      assumptions: [{ id: uid("a"), text: "Values not present in the import are estimated from benchmarks and distance.", source: "assumed", sensitivity: "medium" }],
      rules: [{ id: uid("rule"), text: "No node should operate above 85% of rated capacity on an average week.", kind: "capacity", active: true, createdBy: "template" }],
      parameters: defaultParameters(),
    },
    warnings,
  };
}
