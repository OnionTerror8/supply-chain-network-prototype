import { GAZETTEER, jitter, placeToLocation, roadKm, type GazetteerEntry } from "../domain/geo";
import { aiEstimate, assumed, defaultParameters, uid } from "../domain/helpers";
import type { Assumption, Lane, NetworkModel, NetworkNode, ProductFamily, Temperature } from "../domain/types";
import { DEFAULT_SPEC, type NetworkSpec } from "../library/models";

const g = (city: string) => GAZETTEER.find((x) => x.city === city)!;

const DEMAND_CENTRES: { city: string; weight: number }[] = [
  { city: "London", weight: 18 }, { city: "Birmingham", weight: 9 }, { city: "Manchester", weight: 9 }, { city: "Leeds", weight: 7 },
  { city: "Glasgow", weight: 6 }, { city: "Bristol", weight: 5 }, { city: "Newcastle", weight: 4 }, { city: "Cardiff", weight: 4 },
  { city: "Edinburgh", weight: 4 }, { city: "Nottingham", weight: 4 }, { city: "Liverpool", weight: 4 }, { city: "Sheffield", weight: 3 },
  { city: "Norwich", weight: 3 }, { city: "Southampton", weight: 3 }, { city: "Exeter", weight: 2 }, { city: "Belfast", weight: 3 },
  { city: "Reading", weight: 3 }, { city: "Leicester", weight: 3 }, { city: "Brighton", weight: 2 }, { city: "Aberdeen", weight: 2 },
];
const RDC_SITES = ["Warrington", "Dartford", "Avonmouth", "Glasgow", "Birmingham", "Leeds", "Newcastle", "Cardiff"];
const NDC_SITES = ["Daventry", "Lutterworth", "Doncaster"];
const FACTORY_SITES = ["Spalding", "Wakefield", "Coventry", "Swindon", "Preston"];
const FOOD_SUPPLIERS = ["Spalding", "Evesham", "Kent", "Westland", "Almería", "Lincoln", "Rotterdam", "Perpignan"];
const RETAIL_SUPPLIERS = ["Shenzhen", "Ho Chi Minh City", "Mumbai", "Poznań", "Istanbul", "Shanghai", "Dhaka", "Valencia"];
const GENERIC_SUPPLIERS = ["Birmingham", "Leeds", "Rotterdam", "Manchester", "Poznań", "Barcelona", "Hamburg", "Milan"];
const PORTS = ["Dover", "Felixstowe", "Southampton", "Hull"];

export function buildNetworkFromSpec(input: Partial<NetworkSpec>, name?: string): NetworkModel {
  const spec: NetworkSpec = { ...DEFAULT_SPEC, ...input };
  const nodes: NetworkNode[] = [];
  const lanes: Lane[] = [];
  const assumptions: Assumption[] = [];
  const addAssumption = (text: string, sensitivity: Assumption["sensitivity"] = "medium") =>
    assumptions.push({ id: uid("a"), text, source: "assumed", sensitivity });

  const temp: Temperature = spec.coldChain ? "chilled" : "ambient";
  const weeklyDemand = spec.vertical === "food_manufacturing" ? 240_000 : spec.vertical === "retail_ecommerce" ? 150_000 : 180_000;
  addAssumption(`Total demand assumed at ${weeklyDemand.toLocaleString()} cases/week; replace with actuals when available.`, "high");

  const families: ProductFamily[] = spec.coldChain
    ? [
        { id: "chilled", name: "Chilled products", temperature: "chilled", velocity: "fast", shelfLifeDays: assumed(10, "Typical chilled shelf life"), unitValue: assumed(24), shareOfVolume: assumed(0.6), weeklyShrinkRate: assumed(0.015) },
        { id: "ambient", name: "Ambient products", temperature: "ambient", velocity: "medium", shelfLifeDays: assumed(365), unitValue: assumed(20), shareOfVolume: assumed(0.4), weeklyShrinkRate: assumed(0.002) },
        { id: "raw", name: "Raw materials", temperature: "chilled", velocity: "fast", shelfLifeDays: assumed(7), unitValue: assumed(9), weeklyShrinkRate: assumed(0.04) },
      ]
    : spec.vertical === "retail_ecommerce"
      ? [
          { id: "fast", name: "Fast-moving lines", temperature: "ambient", velocity: "fast", unitValue: assumed(30), shareOfVolume: assumed(0.5), weeklyShrinkRate: assumed(0.001) },
          { id: "bulky", name: "Bulky / slow lines", temperature: "ambient", velocity: "slow", unitValue: assumed(120), shareOfVolume: assumed(0.2), weeklyShrinkRate: assumed(0.002) },
          { id: "core", name: "Core range", temperature: "ambient", velocity: "medium", unitValue: assumed(35), shareOfVolume: assumed(0.3), weeklyShrinkRate: assumed(0.001) },
        ]
      : [
          { id: "fast", name: "Fast-moving lines", temperature: "ambient", velocity: "fast", unitValue: assumed(24), shareOfVolume: assumed(0.55), weeklyShrinkRate: assumed(0.002) },
          { id: "slow", name: "Slow-moving lines", temperature: "ambient", velocity: "slow", unitValue: assumed(40), shareOfVolume: assumed(0.45), weeklyShrinkRate: assumed(0.002) },
          { id: "raw", name: "Raw materials & components", temperature: "ambient", velocity: "medium", unitValue: assumed(8) },
        ];
  const finishedFamilies = families.filter((f) => f.id !== "raw").map((f) => f.id);
  const rawFamilies = families.some((f) => f.id === "raw") ? ["raw"] : finishedFamilies;

  const mk = (id: string, name: string, type: NetworkNode["type"], place: GazetteerEntry, extra: Partial<NetworkNode> = {}, seed = 0): NetworkNode => ({
    id,
    name,
    type,
    temperature: extra.temperature ?? (type === "national_dc" ? (spec.coldChain ? "multi" : "ambient") : temp),
    location: seed ? { ...jitter(place, seed, 0.2), city: place.city, region: place.region, country: place.country, source: "ai" } : placeToLocation(place, "ai"),
    operator: assumed(type === "regional_dc" || type === "cross_dock" ? "3PL" : "Own"),
    ...extra,
  });

  // Customers
  const customers: { node: NetworkNode; demand: number }[] = [];
  const nCust = spec.stores > 0 ? Math.min(spec.stores, DEMAND_CENTRES.length) : Math.min(spec.customerZones, DEMAND_CENTRES.length);
  const chosen = DEMAND_CENTRES.slice(0, Math.max(1, nCust));
  const totalW = chosen.reduce((s, c) => s + c.weight, 0);
  const ecomShare = spec.ecomFromNdc || spec.ecomFc ? 0.06 : 0;
  const storeDemand = weeklyDemand * (1 - ecomShare);
  chosen.forEach((c, i) => {
    const demand = Math.round((storeDemand * c.weight) / totalW / 100) * 100;
    const isStore = spec.stores > 0;
    const perCluster = isStore ? Math.max(1, Math.round((spec.stores * c.weight) / totalW)) : 0;
    const node = mk(
      `c_${i}`,
      isStore ? `${c.city} stores (${perCluster})` : `${c.city} customers`,
      isStore ? "store" : "customer_zone",
      g(c.city),
      isStore ? { inventoryDays: assumed(14, "Store stock cover"), handlingCostPerCase: assumed(1.1) } : {},
      i + 1,
    );
    nodes.push(node);
    customers.push({ node, demand });
  });
  addAssumption(`Demand is split across ${chosen.length} demand centres in proportion to population.`, "medium");

  // Facilities
  const ndcs = NDC_SITES.slice(0, spec.nationalDcs).map((c, i) => mk(`ndc_${i}`, `${c} National DC`, "national_dc", g(c), { inventoryDays: assumed(spec.coldChain ? 4 : 18, "Typical NDC cover") }));
  const rdcs = RDC_SITES.slice(0, spec.regionalDcs).map((c, i) => mk(`rdc_${i}`, `${c} Regional DC`, "regional_dc", g(c), { inventoryDays: assumed(spec.coldChain ? 2.5 : 8, "Typical RDC cover") }));
  const xdocks = RDC_SITES.slice(spec.regionalDcs, spec.regionalDcs + spec.crossDocks).map((c, i) => mk(`xd_${i}`, `${c} Cross-dock`, "cross_dock", g(c), { inventoryDays: assumed(0.3, "Same-day flow-through") }));
  const factories = FACTORY_SITES.slice(0, spec.factories).map((c, i) => mk(`fac_${i}`, `${c} Plant`, "factory", g(c), { inventoryDays: assumed(spec.coldChain ? 1.5 : 5) }));
  const wholesalers = ["Leeds", "Reading"].slice(0, spec.wholesalers).map((c, i) => mk(`ws_${i}`, `${c} wholesaler`, "wholesaler", g(c)));
  nodes.push(...ndcs, ...rdcs, ...xdocks, ...factories, ...wholesalers);

  const supplierCities = spec.vertical === "food_manufacturing" ? FOOD_SUPPLIERS : spec.vertical === "retail_ecommerce" ? RETAIL_SUPPLIERS : GENERIC_SUPPLIERS;
  const suppliers = supplierCities.slice(0, spec.suppliers).map((c, i) =>
    mk(`sup_${i}`, `${c} ${spec.vertical === "food_manufacturing" && g(c).country === "GB" ? "growers" : "supplier"}`, spec.vertical === "food_manufacturing" && g(c).country === "GB" ? "farm" : "supplier", g(c), { temperature: spec.coldChain && spec.vertical === "food_manufacturing" ? "chilled" : "ambient", operator: assumed("Supplier") }),
  );
  nodes.push(...suppliers);
  const needPorts = spec.ports > 0 || suppliers.some((s) => s.location.country !== "GB");
  const ports = needPorts ? PORTS.slice(0, Math.max(1, spec.ports)).map((c, i) => mk(`port_${i}`, `Port of ${c}`, "port", g(c), { temperature: "multi", operator: assumed("Third party") })) : [];
  nodes.push(...ports);

  const estLane = (from: NetworkNode, to: NetworkNode, vol: number, fams: string[], opts: Partial<Lane> = {}): Lane => {
    const km = roadKm(from.location, to.location);
    const mode = opts.mode ?? (km > 2500 ? "sea" : "road");
    const t: Temperature = opts.temperature ?? (from.temperature === "multi" ? to.temperature : from.temperature);
    return {
      id: uid("lane"),
      from: from.id,
      to: to.id,
      mode,
      temperature: t === "multi" ? temp : t,
      productFamilies: fams,
      volumePerWeek: aiEstimate(Math.round(vol), "Derived from assumed demand split"),
      transitDays: aiEstimate(Number((mode === "sea" ? 3 + km / 650 : 0.15 + km / 550).toFixed(1)), "Estimated from distance"),
      crossesBorder: from.location.country !== to.location.country,
      ...opts,
    };
  };

  const nearest = (from: NetworkNode, cands: NetworkNode[]) => cands.reduce<{ n: NetworkNode; d: number } | undefined>((best, c) => {
    const d = roadKm(from.location, c.location);
    return !best || d < best.d ? { n: c, d } : best;
  }, undefined)?.n;

  // Customer service assignment
  const regionalTier = [...rdcs, ...xdocks];
  const serveFrom = regionalTier.length ? regionalTier : ndcs.length ? ndcs : factories;
  const load = new Map<string, number>();
  const chilledFam = families.find((f) => f.temperature === "chilled" && f.id !== "raw")?.id;
  for (const { node, demand } of customers) {
    let d = demand;
    if (spec.directToStoreChilled && chilledFam && factories.length) {
      const share = families.find((f) => f.id === chilledFam)?.shareOfVolume?.value ?? 0.5;
      const fac = nearest(node, factories)!;
      lanes.push(estLane(fac, node, d * share, [chilledFam], { pattern: "direct", temperature: "chilled" }));
      load.set(fac.id, (load.get(fac.id) ?? 0) + d * share);
      d -= d * share;
    }
    const src = nearest(node, serveFrom);
    if (!src) continue;
    const fams = spec.directToStoreChilled && chilledFam ? finishedFamilies.filter((f) => f !== chilledFam) : finishedFamilies;
    lanes.push(estLane(src, node, d, fams, { pattern: regionalTier.length ? undefined : "direct" }));
    load.set(src.id, (load.get(src.id) ?? 0) + d);
    if (spec.backhaul && src.type !== "factory") {
      lanes.push(estLane(node, src, d * 0.03, ["returns"], { pattern: "backhaul", costPerCase: assumed(0.15, "Marginal backhaul cost") }));
    }
  }
  if (spec.backhaul) {
    families.push({ id: "returns", name: "Returnable packaging & returns", temperature: "ambient", velocity: "slow", unitValue: assumed(1) });
    addAssumption("Backhaul volume is 3% of outbound (returnable packaging) at 25–35% of a dedicated movement cost.", "low");
  }
  // Wholesalers
  for (const ws of wholesalers) {
    const src = ndcs[0] ?? factories[0];
    if (!src) continue;
    const vol = weeklyDemand * 0.05;
    lanes.push(estLane(src, ws, vol, finishedFamilies));
    load.set(src.id, (load.get(src.id) ?? 0) + vol);
  }
  // E-commerce
  if (ecomShare > 0) {
    const ecomVol = weeklyDemand * ecomShare;
    const fc = spec.ecomFc
      ? mk("fc_0", "Milton Keynes e-commerce FC", "ecom_fc", g("Milton Keynes"), { inventoryDays: assumed(spec.coldChain ? 3 : 14), handlingCostPerCase: assumed(1.9, "Each-pick benchmark") })
      : mk("fc_0", "DTC fulfilment (in NDC)", "ecom_fc", g(NDC_SITES[0]), { handlingCostPerCase: assumed(2.1, "Each-pick benchmark") });
    const dtc = mk("c_dtc", "Online customers", "customer_zone", g("Oxford"));
    nodes.push(fc, dtc);
    const feeder = ndcs[0] ?? factories[0];
    if (feeder) {
      lanes.push(estLane(feeder, fc, ecomVol, finishedFamilies, spec.ecomFc ? {} : { costPerCase: assumed(0.05, "Internal transfer") }));
      load.set(feeder.id, (load.get(feeder.id) ?? 0) + ecomVol);
    }
    lanes.push(estLane(fc, dtc, ecomVol, finishedFamilies, { mode: "parcel", pattern: "last_mile", costPerCase: assumed(spec.coldChain ? 6.8 : 4.2, "Parcel benchmark"), transitDays: assumed(1.3) }));
    addAssumption("E-commerce is 6% of volume, fulfilled as eaches with parcel delivery.", "medium");
  }
  // Regional tier fed from NDC (or factory)
  for (const r of regionalTier) {
    const vol = load.get(r.id) ?? 0;
    const src = ndcs.length ? nearest(r, ndcs)! : nearest(r, factories);
    if (!src || vol <= 0) continue;
    lanes.push(estLane(src, r, vol, finishedFamilies));
    load.set(src.id, (load.get(src.id) ?? 0) + vol);
  }
  // NDC fed from factories (or suppliers for retail)
  for (const n of ndcs) {
    const vol = load.get(n.id) ?? 0;
    const feeders = factories.length ? factories : [];
    if (feeders.length) {
      feeders.forEach((f, i) => {
        const share = feeders.length === 1 ? 1 : i === 0 ? 0.6 : 0.4 / (feeders.length - 1);
        lanes.push(estLane(f, n, vol * share, finishedFamilies));
        load.set(f.id, (load.get(f.id) ?? 0) + vol * share);
      });
    }
  }
  // Inbound: suppliers -> factories (or NDC for retail / no-factory networks)
  const receivers = factories.length ? factories : ndcs.length ? ndcs : regionalTier;
  const inboundRatio = factories.length ? 1.15 : 1.0;
  for (const rec of receivers) {
    const vol = (load.get(rec.id) ?? 0) * inboundRatio;
    if (vol <= 0 || !suppliers.length) continue;
    suppliers.forEach((s, i) => {
      const share = (suppliers.length - i + 1) / ((suppliers.length * (suppliers.length + 3)) / 2);
      const v = vol * share;
      const foreign = s.location.country !== "GB";
      if (foreign && ports.length) {
        const port = nearest(rec, ports)!;
        const existing = lanes.find((l) => l.from === s.id && l.to === port.id);
        if (existing) existing.volumePerWeek = aiEstimate(existing.volumePerWeek.value + Math.round(v), "Derived from assumed demand split");
        else lanes.push(estLane(s, port, v, rawFamilies, { mode: roadKm(s.location, port.location) > 2500 ? "sea" : "road", crossesBorder: true }));
        const p2 = lanes.find((l) => l.from === port.id && l.to === rec.id);
        if (p2) p2.volumePerWeek = aiEstimate(p2.volumePerWeek.value + Math.round(v), "Derived from assumed demand split");
        else lanes.push(estLane(port, rec, v, rawFamilies));
      } else {
        lanes.push(estLane(s, rec, v, rawFamilies, spec.milkRuns && !foreign ? { pattern: "milk_run", costPerCase: assumed(Number((0.0062 * roadKm(s.location, rec.location) * 0.75 + 0.3).toFixed(2)), "Milk-run collection: −25% vs part-load") } : {}));
      }
    });
  }
  if (spec.milkRuns) addAssumption("UK supplier collections run as milk runs at 25% below individual part-load cost.", "medium");

  // Returns centre
  if (spec.returns && (spec.ecomFc || spec.ecomFromNdc)) {
    const rc = mk("ret_0", "Northampton returns centre", "returns_center", g("Northampton"), { handlingCostPerCase: assumed(3.4) });
    nodes.push(rc);
    const dtc = nodes.find((n) => n.id === "c_dtc");
    if (dtc) {
      lanes.push(estLane(dtc, rc, weeklyDemand * ecomShare * (spec.coldChain ? 0.02 : 0.14), ["returns"], { mode: "parcel", pattern: "returns", costPerCase: assumed(3.1) }));
      if (!families.some((f) => f.id === "returns")) families.push({ id: "returns", name: "Customer returns", temperature: "ambient", velocity: "slow", unitValue: assumed(30) });
    }
  }

  // Capacities and costs sized from flows (clearly assumed)
  const thru = new Map<string, number>();
  for (const l of lanes) {
    if (l.pattern === "returns" || l.pattern === "backhaul") continue;
    thru.set(l.to, (thru.get(l.to) ?? 0) + l.volumePerWeek.value);
    thru.set(l.from, Math.max(thru.get(l.from) ?? 0, 0));
  }
  const outThru = new Map<string, number>();
  for (const l of lanes) if (l.pattern !== "returns" && l.pattern !== "backhaul") outThru.set(l.from, (outThru.get(l.from) ?? 0) + l.volumePerWeek.value);
  for (const n of nodes) {
    const t = Math.max(thru.get(n.id) ?? 0, outThru.get(n.id) ?? 0);
    if (t <= 0) continue;
    const util = n.type === "national_dc" ? 0.86 : n.type === "factory" ? 0.82 : n.type === "cross_dock" ? 0.6 : 0.7;
    if (["factory", "national_dc", "regional_dc", "cross_dock", "ecom_fc", "cold_store"].includes(n.type)) {
      n.capacityPerWeek = assumed(Math.round((t / util) / 1000) * 1000, `Sized at ${Math.round(util * 100)}% utilisation of modelled flow; confirm rated capacity`);
      const perCase: Record<string, number> = { factory: 72, national_dc: 40, regional_dc: 52, cross_dock: 18, ecom_fc: 180, cold_store: 68 };
      n.fixedCostPerYear = assumed(Math.round(perCase[n.type] * t), `Benchmark £${perCase[n.type]} per case-week of throughput`);
      const handling: Record<string, number> = { factory: 0.3, national_dc: 0.6, regional_dc: 0.5, cross_dock: 0.28, ecom_fc: 1.9, cold_store: 0.7 };
      n.handlingCostPerCase = n.handlingCostPerCase ?? assumed(handling[n.type], "Industry benchmark");
      n.reliability = assumed(0.95, "Network default");
    }
    if (["farm", "supplier"].includes(n.type)) {
      n.capacityPerWeek = assumed(Math.round((t / 0.75) / 1000) * 1000, "Sized at 75% of modelled flow");
      n.reliability = assumed(n.location.country === "GB" ? 0.95 : 0.9, "Default by origin");
    }
  }
  addAssumption("Facility capacities are sized from modelled flows (NDC at 86%, factories at 82%, RDCs at 70%); replace with rated capacities.", "high");
  addAssumption("Facility fixed and handling costs use UK industry benchmarks per case-week.", "medium");
  addAssumption("Lane costs are estimated from road distance at £0.0062 per case-km plus £0.42 handling per leg.", "medium");

  // Regions
  const regionMap = new Map<string, string[]>();
  for (const c of customers) {
    const r = c.node.location.region ?? "Other";
    regionMap.set(r, [...(regionMap.get(r) ?? []), c.node.id]);
  }
  const regions = [...regionMap.entries()].map(([r, ids]) => ({
    id: `r_${r.toLowerCase().replace(/\s+/g, "_")}`,
    name: r,
    nodeIds: ids,
    seasonalityPeakFactor: assumed(spec.seasonal ? 1.35 : 1.15, spec.seasonal ? "Significant seasonality stated" : "Light seasonality default"),
  }));
  if (spec.seasonal) addAssumption("Seasonal peak is +35% on average weekly demand for roughly 10 weeks.", "high");

  const rules = [
    { id: uid("rule"), text: `No node should operate above 85% of rated capacity on an average week.`, kind: "capacity" as const, active: true, createdBy: "template" as const },
    { id: uid("rule"), text: `Customers are served from the nearest ${regionalTier.length ? "regional" : "national"} facility.`, kind: "allocation" as const, active: true, createdBy: "template" as const },
    ...(spec.coldChain ? [{ id: uid("rule"), text: "Chilled products must arrive with at least 75% of shelf life remaining.", kind: "temperature" as const, active: true, createdBy: "template" as const }] : []),
  ];

  return {
    id: uid("model"),
    name: name ?? describeSpec(spec),
    vertical: spec.vertical,
    currency: "GBP",
    description: describeSpec(spec),
    nodes,
    lanes,
    productFamilies: families,
    regions,
    assumptions,
    rules,
    parameters: defaultParameters(),
  };
}

export function describeSpec(spec: NetworkSpec) {
  const parts: string[] = [];
  if (spec.suppliers) parts.push(`${spec.suppliers} supplier${spec.suppliers > 1 ? "s" : ""}`);
  if (spec.factories) parts.push(`${spec.factories} factor${spec.factories > 1 ? "ies" : "y"}`);
  if (spec.nationalDcs) parts.push(`${spec.nationalDcs} national DC${spec.nationalDcs > 1 ? "s" : ""}`);
  if (spec.regionalDcs) parts.push(`${spec.regionalDcs} regional DC${spec.regionalDcs > 1 ? "s" : ""}`);
  if (spec.crossDocks) parts.push(`${spec.crossDocks} cross-dock${spec.crossDocks > 1 ? "s" : ""}`);
  if (spec.stores) parts.push(`${spec.stores} stores`);
  else parts.push(`${spec.customerZones} customer regions`);
  if (spec.ecomFromNdc || spec.ecomFc) parts.push("e-commerce");
  const extras = [spec.milkRuns && "milk runs", spec.backhaul && "backhaul", spec.directToStoreChilled && "direct-to-store chilled", spec.coldChain && "cold chain", spec.seasonal && "seasonal demand"].filter(Boolean);
  return `${parts.join(", ")}${extras.length ? ` with ${extras.join(", ")}` : ""}`;
}
