import type { NetworkModel, NetworkNode, NodeType } from "../domain/types";
import type { NetworkSpec } from "../library/models";

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100,
};

export function wordToNumber(w: string): number | undefined {
  const n = Number(w.replace(/,/g, ""));
  if (!Number.isNaN(n)) return n;
  return NUMBER_WORDS[w.toLowerCase()];
}

/** Find "<number> <noun>" patterns such as "five suppliers", "2 factories", "a national DC". */
export function countBefore(text: string, nounPattern: string): number | undefined {
  const re = new RegExp(`\\b(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:[a-z-]+\\s+){0,2}?(?:${nounPattern})\\b`, "i");
  const m = text.match(re);
  if (!m) return undefined;
  return wordToNumber(m[1]);
}

export function parseSpecFromText(text: string): Partial<NetworkSpec> {
  const t = text.toLowerCase();
  const spec: Partial<NetworkSpec> = {};
  const sup = countBefore(t, "suppliers?|growers?|farms?|vendors?|sources?");
  if (sup !== undefined) spec.suppliers = sup;
  const fac = countBefore(t, "factor(?:y|ies)|plants?|manufacturing sites?|sites?|co-?packers?");
  if (fac !== undefined) spec.factories = fac;
  const ndc = countBefore(t, "national (?:dcs?|distribution cent(?:re|er)s?|warehouses?)|ndcs?|central (?:dcs?|warehouses?)|import cent(?:re|er)s?");
  if (ndc !== undefined) spec.nationalDcs = ndc;
  else if (/\bnational dc\b|\bndc\b|central (?:dc|warehouse)|import cent/.test(t)) spec.nationalDcs = 1;
  const rdc = countBefore(t, "regional (?:dcs?|distribution cent(?:re|er)s?|warehouses?|depots?)|rdcs?|regional hubs?");
  if (rdc !== undefined) spec.regionalDcs = rdc;
  else if (/regional (?:dcs?|distribution|warehouses|depots|hubs)|\brdcs?\b/.test(t)) spec.regionalDcs = 3;
  const xd = countBefore(t, "cross-?docks?|x-?docks?");
  if (xd !== undefined) spec.crossDocks = xd;
  const stores = countBefore(t, "stores?|shops?|outlets?|branches?");
  if (stores !== undefined) spec.stores = stores;
  else if (/\bstores?\b|\bshops?\b|\boutlets?\b/.test(t) && !/ship-from-store|direct.to.store|store delivery/.test(t)) spec.stores = 40;
  const cust = countBefore(t, "customers?|customer regions?|regions?|markets?|cities");
  if (cust !== undefined && !spec.stores) spec.customerZones = cust;
  const ws = countBefore(t, "wholesalers?|distributors?");
  if (ws !== undefined) spec.wholesalers = ws;
  const ports = countBefore(t, "ports?");
  if (ports !== undefined) spec.ports = ports;
  else if (/\bports?\b|import/.test(t)) spec.ports = 1;

  if (/e-?com(?:merce)?|online|web orders|d2c|dtc|direct.to.consumer/.test(t)) {
    if (/from (?:the )?(?:national dc|ndc|dc)/.test(t)) spec.ecomFromNdc = true;
    else spec.ecomFc = true;
  }
  if (/milk.?runs?/.test(t)) spec.milkRuns = true;
  if (/backhaul|back-?shipment|backload/.test(t)) spec.backhaul = true;
  if (/direct.to.store|direct store|dsd\b/.test(t)) spec.directToStoreChilled = true;
  if (/ship.from.store|store fulfil/.test(t)) spec.shipFromStore = true;
  if (/returns?|reverse/.test(t)) spec.returns = true;
  if (/cold.?chain|chilled|temperature|perishable|fresh|frozen/.test(t)) spec.coldChain = true;
  if (/seasonal|peak|christmas|summer/.test(t)) spec.seasonal = true;
  if (/food|grocery|fresh|chilled|farm|harvest|ingredient|bakery|dairy|meat|produce|cold.?chain|raw material|perishab|shelf.life/.test(t)) spec.vertical = "food_manufacturing";
  else if (/retail|e-?com|store|garden|fashion|apparel|homeware|electrical|furniture/.test(t)) spec.vertical = "retail_ecommerce";
  if (/\buk\b|britain|england|united kingdom/.test(t)) spec.country = "GB";
  return spec;
}

export function tokens(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüñçß\s-]/g, " ").split(/[\s-]+/).filter((w) => w.length > 2);
}

const STOP = new Set(["the", "and", "for", "with", "from", "this", "that", "our", "into", "dc", "rdc", "ndc", "dcs", "national", "regional", "centre", "center", "stores", "store", "customers", "customer", "plant", "port", "supplier", "growers", "what", "happens", "lose", "remove", "close", "add", "model", "scenario", "would", "happen", "capacity", "operated", "operating", "operate"]);

export function matchNode(model: NetworkModel, text: string, typeHint?: NodeType[]): NetworkNode | undefined {
  const words = tokens(text).filter((w) => !STOP.has(w));
  let best: NetworkNode | undefined;
  let bestScore = 0;
  for (const n of model.nodes) {
    if (typeHint && !typeHint.includes(n.type)) continue;
    const nameTokens = new Set(tokens(n.name));
    if (n.location.city) tokens(n.location.city).forEach((t) => nameTokens.add(t));
    let score = 0;
    for (const w of words) {
      for (const nt of nameTokens) {
        if (nt === w) score += 3;
        else if (nt.startsWith(w) || w.startsWith(nt)) score += 1;
      }
    }
    // Type words as a weak boost
    if (/\bport\b/.test(text) && n.type === "port") score += 1;
    if (/supplier|grower|farm/.test(text) && (n.type === "supplier" || n.type === "farm")) score += 1;
    if (/factory|plant/.test(text) && n.type === "factory") score += 1;
    if (/\brdc\b|regional/.test(text) && n.type === "regional_dc") score += 1;
    if (/\bndc\b|national/.test(text) && n.type === "national_dc") score += 1;
    if (/warehouse|dc\b/.test(text) && ["regional_dc", "national_dc"].includes(n.type)) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return bestScore >= 3 ? best : undefined;
}

export function percentIn(text: string): number | undefined {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return Number(m[1]);
  const m2 = text.match(/(\d+(?:\.\d+)?)\s*(?:percent|per cent|pct)/i);
  if (m2) return Number(m2[1]);
  return undefined;
}
