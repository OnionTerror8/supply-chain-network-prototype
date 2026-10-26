import { defaultParameters } from "../domain/helpers";
import type { NetworkModel } from "../domain/types";

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "network";
}

/** Download a network as canonical tagged JSON (the native Meridian shape). */
export function downloadNetworkJson(model: NetworkModel, filename?: string) {
  const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `${slug(model.name)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseNetworkJson(raw: unknown): NetworkModel {
  if (!raw || typeof raw !== "object") throw new Error("File is not a JSON object.");
  const m = raw as Partial<NetworkModel>;
  if (!Array.isArray(m.nodes) || !Array.isArray(m.lanes)) {
    throw new Error("JSON must include nodes[] and lanes[]. Download the canonical starter for the expected shape.");
  }
  if (!m.nodes.length) throw new Error("Network has no nodes.");
  return {
    id: typeof m.id === "string" ? m.id : "imported_json",
    name: typeof m.name === "string" ? m.name : "Imported network",
    vertical: m.vertical ?? "generic",
    currency: typeof m.currency === "string" ? m.currency : "GBP",
    description: m.description,
    nodes: m.nodes,
    lanes: m.lanes,
    productFamilies: m.productFamilies ?? [],
    regions: m.regions ?? [],
    assumptions: m.assumptions ?? [],
    rules: m.rules ?? [],
    goals: m.goals,
    parameters: m.parameters ?? defaultParameters(),
  };
}

export function isJsonNetworkFile(file: File) {
  return /\.json$/i.test(file.name) || file.type === "application/json";
}
