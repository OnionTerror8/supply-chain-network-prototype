import { placeToLocation, GAZETTEER } from "../domain/geo";
import { assumed, confirmed, defaultParameters, userValue } from "../domain/helpers";
import type { Lane, NetworkModel, NetworkNode, Tagged, Temperature, TransportMode } from "../domain/types";

/**
 * Compact “how to design a network for Meridian” sample.
 *
 * This is the intended construction pattern, not a full commercial dataset:
 * physical flow origin → customer, every quantity tagged, goals/rules/
 * assumptions beside the graph, peak as a regional factor, scenarios later
 * as change lists (never by silently editing the baseline).
 */
const place = (city: string) => {
  const p = GAZETTEER.find((g) => g.city === city);
  if (!p) throw new Error(`Unknown place ${city}`);
  return p;
};

function node(spec: Omit<NetworkNode, "location"> & { city: string }): NetworkNode {
  const { city, ...rest } = spec;
  return { ...rest, location: placeToLocation(place(city), "confirmed") };
}

function lane(s: {
  id: string;
  from: string;
  to: string;
  mode?: TransportMode;
  temperature: Temperature;
  families: string[];
  volume: Tagged;
  cost?: Tagged;
  transit?: Tagged;
  reliability?: Tagged;
  crossesBorder?: boolean;
  pattern?: Lane["pattern"];
}): Lane {
  return {
    id: s.id,
    from: s.from,
    to: s.to,
    mode: s.mode ?? "road",
    temperature: s.temperature,
    productFamilies: s.families,
    volumePerWeek: s.volume,
    costPerCase: s.cost,
    transitDays: s.transit,
    reliability: s.reliability,
    crossesBorder: s.crossesBorder,
    pattern: s.pattern,
  };
}

export function buildCanonicalSample(): NetworkModel {
  const nodes: NetworkNode[] = [
    node({
      id: "farm_spalding",
      name: "Fenland Growers",
      type: "farm",
      city: "Spalding",
      temperature: "chilled",
      capacityPerWeek: confirmed(40_000, "Grower contract"),
      reliability: confirmed(0.96, "12-month OTIF"),
      operator: confirmed("Contract grower"),
    }),
    node({
      id: "sup_westland",
      name: "Westland Glasshouses",
      type: "supplier",
      city: "Westland",
      temperature: "chilled",
      capacityPerWeek: confirmed(28_000, "Supplier declared"),
      reliability: confirmed(0.94, "Carrier POD"),
      operator: confirmed("Supplier"),
    }),
    node({
      id: "port_dover",
      name: "Port of Dover",
      type: "port",
      city: "Dover",
      temperature: "chilled",
      reliability: confirmed(0.88, "Border dwell log"),
      operator: confirmed("Third party"),
      tags: ["Ro-Ro", "sole import gateway"],
    }),
    node({
      id: "factory_spalding",
      name: "Spalding Chilled Plant",
      type: "factory",
      city: "Spalding",
      temperature: "chilled",
      capacityPerWeek: confirmed(70_000, "Line-rated, 2-shift"),
      inventoryDays: confirmed(1.5, "WMS"),
      fixedCostPerYear: confirmed(6_400_000, "FY25 budget"),
      handlingCostPerCase: confirmed(0.31, "Cost centre"),
      reliability: confirmed(0.97),
      operator: confirmed("Own"),
    }),
    node({
      id: "ndc_daventry",
      name: "Daventry NDC",
      type: "national_dc",
      city: "Daventry",
      temperature: "chilled",
      capacityPerWeek: confirmed(72_000, "Dock study 2024"),
      inventoryDays: confirmed(3.8, "WMS"),
      fixedCostPerYear: confirmed(4_800_000, "3PL open-book"),
      handlingCostPerCase: confirmed(0.56, "3PL rate card"),
      reliability: confirmed(0.95),
      operator: confirmed("3PL – open book"),
      notes: "Sized tight on purpose so the overview shows a constrained national node.",
    }),
    node({
      id: "rdc_dartford",
      name: "Dartford RDC",
      type: "regional_dc",
      city: "Dartford",
      temperature: "chilled",
      capacityPerWeek: confirmed(32_000),
      inventoryDays: confirmed(2.0),
      fixedCostPerYear: confirmed(1_900_000),
      handlingCostPerCase: confirmed(0.49),
      reliability: confirmed(0.93),
      operator: confirmed("3PL"),
    }),
    node({
      id: "rdc_warrington",
      name: "Warrington RDC",
      type: "regional_dc",
      city: "Warrington",
      temperature: "chilled",
      capacityPerWeek: confirmed(30_000),
      inventoryDays: confirmed(2.2),
      fixedCostPerYear: confirmed(1_700_000),
      handlingCostPerCase: confirmed(0.46),
      reliability: confirmed(0.95),
      operator: confirmed("3PL"),
    }),
    node({
      id: "cz_london",
      name: "Grocery – London",
      type: "customer_zone",
      city: "London",
      temperature: "chilled",
    }),
    node({
      id: "cz_birmingham",
      name: "Grocery – Birmingham",
      type: "customer_zone",
      city: "Birmingham",
      temperature: "chilled",
    }),
    node({
      id: "cz_manchester",
      name: "Grocery – Manchester",
      type: "customer_zone",
      city: "Manchester",
      temperature: "chilled",
    }),
  ];

  const lanes: Lane[] = [
    lane({
      id: "l_farm_factory",
      from: "farm_spalding",
      to: "factory_spalding",
      temperature: "chilled",
      families: ["salads"],
      volume: confirmed(22_000, "Goods receipt, 13-wk avg"),
      cost: confirmed(0.12),
      transit: confirmed(0.2),
      reliability: confirmed(0.98),
      pattern: "milk_run",
    }),
    lane({
      id: "l_nl_dover",
      from: "sup_westland",
      to: "port_dover",
      temperature: "chilled",
      families: ["salads"],
      volume: confirmed(18_000, "Customs declarations"),
      cost: confirmed(1.65),
      transit: confirmed(1.1),
      reliability: confirmed(0.94),
      crossesBorder: true,
    }),
    lane({
      id: "l_dover_factory",
      from: "port_dover",
      to: "factory_spalding",
      temperature: "chilled",
      families: ["salads"],
      volume: confirmed(18_000),
      cost: confirmed(0.96),
      transit: confirmed(0.5),
      reliability: confirmed(0.9),
    }),
    lane({
      id: "l_factory_ndc",
      from: "factory_spalding",
      to: "ndc_daventry",
      temperature: "chilled",
      families: ["salads", "ready_meals"],
      volume: confirmed(64_000, "Dispatch log"),
      cost: confirmed(0.71),
      transit: confirmed(0.4),
      reliability: confirmed(0.97),
    }),
    lane({
      id: "l_ndc_dartford",
      from: "ndc_daventry",
      to: "rdc_dartford",
      temperature: "chilled",
      families: ["salads", "ready_meals"],
      volume: confirmed(28_000),
      cost: confirmed(0.92),
      transit: confirmed(0.5),
      reliability: confirmed(0.93),
    }),
    lane({
      id: "l_ndc_warrington",
      from: "ndc_daventry",
      to: "rdc_warrington",
      temperature: "chilled",
      families: ["salads", "ready_meals"],
      volume: confirmed(22_000),
      cost: confirmed(0.88),
      transit: confirmed(0.5),
      reliability: confirmed(0.95),
    }),
    lane({
      id: "l_ndc_birmingham",
      from: "ndc_daventry",
      to: "cz_birmingham",
      temperature: "chilled",
      families: ["ready_meals"],
      volume: confirmed(14_000),
      cost: confirmed(0.66),
      transit: confirmed(0.3),
      reliability: confirmed(0.95),
      pattern: "direct",
    }),
    lane({
      id: "l_dartford_london",
      from: "rdc_dartford",
      to: "cz_london",
      temperature: "chilled",
      families: ["salads", "ready_meals"],
      volume: confirmed(28_000),
      cost: confirmed(0.58),
      transit: confirmed(0.3),
      reliability: confirmed(0.94),
    }),
    lane({
      id: "l_warrington_manchester",
      from: "rdc_warrington",
      to: "cz_manchester",
      temperature: "chilled",
      families: ["salads", "ready_meals"],
      volume: confirmed(22_000),
      cost: confirmed(0.49),
      transit: confirmed(0.2),
      reliability: confirmed(0.96),
    }),
  ];

  return {
    id: "canonical_midlands_chilled",
    name: "Midlands chilled starter",
    vertical: "food_manufacturing",
    currency: "GBP",
    description:
      "Canonical 10-node design sample: UK grower + NL import via Dover into one factory, a tight NDC, two RDCs and three grocery regions. Every quantity is tagged. Use this shape when describing or importing a new network.",
    nodes,
    lanes,
    productFamilies: [
      {
        id: "salads",
        name: "Prepared salads",
        temperature: "chilled",
        velocity: "fast",
        shelfLifeDays: confirmed(6, "Spec sheet"),
        unitValue: confirmed(19.2, "Standard cost"),
        shareOfVolume: confirmed(0.45),
        weeklyShrinkRate: confirmed(0.03, "Waste log"),
      },
      {
        id: "ready_meals",
        name: "Chilled ready meals",
        temperature: "chilled",
        velocity: "fast",
        shelfLifeDays: confirmed(10, "Spec sheet"),
        unitValue: confirmed(28.5, "Standard cost"),
        shareOfVolume: confirmed(0.55),
        weeklyShrinkRate: confirmed(0.012, "Waste log"),
      },
    ],
    regions: [
      { id: "r_se", name: "South East", nodeIds: ["cz_london"], seasonalityPeakFactor: confirmed(1.38, "FY24 weekly demand") },
      { id: "r_mid", name: "Midlands", nodeIds: ["cz_birmingham"], seasonalityPeakFactor: assumed(1.3, "No weekly feed yet") },
      { id: "r_nw", name: "North West", nodeIds: ["cz_manchester"], seasonalityPeakFactor: assumed(1.28) },
    ],
    assumptions: [
      {
        id: "a_peak",
        text: "South East peak of +38% is confirmed; Midlands and North West peaks are assumed.",
        source: "assumed",
        sensitivity: "high",
        appliesTo: ["r_mid", "r_nw"],
      },
      {
        id: "a_carry",
        text: "Inventory carrying cost is 18% of case value per year.",
        source: "assumed",
        sensitivity: "medium",
      },
    ],
    rules: [
      { id: "ru_shelf", text: "Chilled product must arrive with at least 75% of shelf life remaining.", kind: "temperature", active: true, createdBy: "user" },
      { id: "ru_cap", text: "No node should operate above 85% of rated capacity on an average week.", kind: "capacity", active: true, createdBy: "template" },
      { id: "ru_svc", text: "Target 97.5% case-fill to grocery customers.", kind: "service", active: true, createdBy: "user" },
    ],
    goals: { primary: "cost", secondary: ["resilience", "service"] },
    parameters: defaultParameters(),
  };
}
