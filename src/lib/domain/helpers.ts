import type {
  Confidence,
  ModelParameters,
  NetworkModel,
  NetworkNode,
  Provenance,
  Tagged,
  TransportMode,
} from "./types";

let counter = 0;
export function uid(prefix = "id") {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export const tag = <T>(value: T, source: Provenance, note?: string, range?: [T, T]): Tagged<T> => ({
  value,
  source,
  ...(note ? { note } : {}),
  ...(range ? { range } : {}),
});

export const confirmed = <T>(value: T, note?: string) => tag(value, "confirmed", note);
export const userValue = <T>(value: T, note?: string) => tag(value, "user", note);
export const assumed = <T>(value: T, note?: string, range?: [T, T]) => tag(value, "assumed", note, range);
export const aiEstimate = <T>(value: T, note?: string, range?: [T, T]) => tag(value, "ai", note, range);

export function sourceWeight(source: Provenance): number {
  switch (source) {
    case "confirmed":
      return 1;
    case "user":
      return 0.85;
    case "ai":
      return 0.55;
    case "assumed":
      return 0.4;
    case "missing":
      return 0;
  }
}

export function scoreToConfidence(score: number, hasData = true): Confidence {
  if (!hasData) return "insufficient";
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  if (score >= 0.25) return "low";
  return "insufficient";
}

export function defaultParameters(): ModelParameters {
  const perKm = (road: number): Record<TransportMode, Tagged> => ({
    road: assumed(road, "UK contract haulage benchmark, full-truck, 2024"),
    rail: assumed(road * 0.6, "Intermodal rail, excludes terminal handling"),
    sea: assumed(road * 0.12, "Deep-sea container, per case-km equivalent"),
    air: assumed(road * 9, "Air freight benchmark"),
    parcel: assumed(road * 4.5, "Parcel network per case-km equivalent"),
    van: assumed(road * 3.2, "Home-delivery van, includes driver time"),
  });
  return {
    costPerCaseKm: perKm(0.0062),
    laneHandlingPerCase: assumed(0.42, "Load + unload per leg, industry median"),
    emissionsPerCaseKm: {
      road: assumed(0.0011, "DEFRA 2024 HGV average, 12 kg case"),
      rail: assumed(0.00028, "DEFRA 2024 rail freight"),
      sea: assumed(0.00016, "DEFRA 2024 container ship"),
      air: assumed(0.0092, "DEFRA 2024 air freight"),
      parcel: assumed(0.0025, "Parcel network incl. sortation"),
      van: assumed(0.0032, "Diesel LCV average"),
    },
    inventoryCarryingRate: assumed(0.18, "Capital + storage + obsolescence, 18%/yr"),
    defaultCaseValue: assumed(24, "Blended case value where product value is unknown"),
    stockoutCostPerCase: assumed(9.5, "Lost margin plus expediting, per case short"),
    carbonPricePerTonne: assumed(85, "Internal shadow carbon price, £/tCO2e"),
    constrainedUtilisation: assumed(0.85, "Above 85% utilisation, throughput variability bites"),
    weeksPerYear: 52,
  };
}

export function nodeById(model: NetworkModel, id: string): NetworkNode | undefined {
  return model.nodes.find((n) => n.id === id);
}

export function cloneModel(model: NetworkModel): NetworkModel {
  return JSON.parse(JSON.stringify(model));
}

export function fmtMoney(v: number, currency = "GBP", compact = true) {
  const abs = Math.abs(v);
  if (compact) {
    if (abs >= 1_000_000_000) return `${sign(v)}${symbol(currency)}${(abs / 1e9).toFixed(2)}bn`;
    if (abs >= 1_000_000) return `${sign(v)}${symbol(currency)}${(abs / 1e6).toFixed(abs >= 10_000_000 ? 1 : 2)}m`;
    if (abs >= 1_000) return `${sign(v)}${symbol(currency)}${(abs / 1e3).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  }
  return `${sign(v)}${symbol(currency)}${abs.toFixed(abs < 10 ? 2 : 0)}`;
}

function sign(v: number) {
  return v < 0 ? "−" : "";
}

function symbol(currency: string) {
  return currency === "GBP" ? "£" : currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
}

export function fmtNum(v: number, digits = 0) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1e6).toFixed(1)}m`;
  if (abs >= 10_000) return `${(v / 1e3).toFixed(0)}k`;
  if (abs >= 1_000) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(digits);
}

export function fmtPct(v: number, digits = 0) {
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtDelta(v: number, formatter: (n: number) => string, invert = false) {
  const good = invert ? v > 0 : v < 0;
  const s = v > 0 ? "+" : "";
  return { text: `${s}${formatter(v)}`, good, neutral: Math.abs(v) < 1e-9 };
}
