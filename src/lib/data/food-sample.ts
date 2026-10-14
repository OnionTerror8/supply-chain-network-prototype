import { GAZETTEER, placeToLocation } from "../domain/geo";
import { assumed, confirmed, defaultParameters, userValue } from "../domain/helpers";
import type { Lane, NetworkModel, NetworkNode, Tagged, Temperature, TransportMode } from "../domain/types";

const place = (city: string) => {
  const p = GAZETTEER.find((g) => g.city === city);
  if (!p) throw new Error(`Unknown place ${city}`);
  return p;
};

type NodeSpec = Omit<NetworkNode, "location"> & { city: string; locSource?: "confirmed" | "user" };

function node(spec: NodeSpec): NetworkNode {
  const { city, locSource, ...rest } = spec;
  return { ...rest, location: placeToLocation(place(city), locSource ?? "confirmed") };
}

interface LaneSpec {
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
}

function lane(s: LaneSpec): Lane {
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

export function buildFoodSample(): NetworkModel {
  const nodes: NetworkNode[] = [
    // Origin
    node({ id: "f_spalding", name: "Fenland Growers – Spalding", type: "farm", city: "Spalding", temperature: "chilled",
      capacityPerWeek: confirmed(48_000, "Grower contract 2025"), reliability: confirmed(0.96, "12-month OTIF"),
      operator: confirmed("Contract grower"), tags: ["salad leaf", "UK season Apr–Oct"] }),
    node({ id: "f_evesham", name: "Vale of Evesham Co-op", type: "farm", city: "Evesham", temperature: "chilled",
      capacityPerWeek: userValue(36_000, "Entered by planner"), reliability: assumed(0.93, "No OTIF feed yet"),
      operator: confirmed("Grower co-operative"), tags: ["brassicas", "root veg"] }),
    node({ id: "f_kent", name: "Kent Orchards", type: "farm", city: "Kent", temperature: "chilled",
      capacityPerWeek: userValue(24_000), reliability: assumed(0.93), operator: confirmed("Grower"), tags: ["top fruit", "soft fruit"] }),
    node({ id: "s_westland", name: "Westland Glasshouses (NL)", type: "supplier", city: "Westland", temperature: "chilled",
      capacityPerWeek: confirmed(60_000, "Supplier declared"), reliability: confirmed(0.94, "Carrier POD data"),
      operator: confirmed("Supplier"), tags: ["tomatoes", "peppers", "cucumbers"] }),
    node({ id: "s_almeria", name: "Almería Growers (ES)", type: "supplier", city: "Almería", temperature: "chilled",
      capacityPerWeek: confirmed(70_000, "Supplier declared"), reliability: confirmed(0.86, "Carrier POD data, winter 24/25"),
      operator: confirmed("Supplier"), tags: ["winter salad", "sole winter source"] }),
    node({ id: "s_rotterdam", name: "Euro Ingredients BV", type: "supplier", city: "Rotterdam", temperature: "ambient",
      reliability: assumed(0.95), operator: confirmed("Supplier"), tags: ["oils", "sauces base"] }),
    node({ id: "s_lincoln", name: "Lincolnshire Mills", type: "supplier", city: "Lincoln", temperature: "ambient",
      capacityPerWeek: confirmed(40_000), reliability: confirmed(0.98), operator: confirmed("Supplier"), tags: ["flour", "starches"] }),
    node({ id: "s_pack", name: "Midland Packaging", type: "supplier", city: "Leicester", temperature: "ambient",
      reliability: assumed(0.97), operator: confirmed("Supplier"), tags: ["trays", "film", "cartons"] }),
    // Inbound gateways
    node({ id: "p_dover", name: "Port of Dover", type: "port", city: "Dover", temperature: "multi",
      capacityPerWeek: assumed(400_000, "Not a binding constraint for this business"), reliability: confirmed(0.88, "Border Force dwell time log"),
      operator: confirmed("Third party"), tags: ["Ro-Ro", "SPS checks"] }),
    node({ id: "p_felixstowe", name: "Port of Felixstowe", type: "port", city: "Felixstowe", temperature: "ambient",
      reliability: assumed(0.92), operator: confirmed("Third party"), tags: ["container"] }),
    // Manufacturing
    node({ id: "m_spalding", name: "Spalding Chilled Plant", type: "factory", city: "Spalding", temperature: "chilled",
      capacityPerWeek: confirmed(195_000, "Line-rated capacity, 3-shift"), inventoryDays: confirmed(1.5, "WMS"),
      fixedCostPerYear: confirmed(14_200_000, "FY25 budget"), handlingCostPerCase: confirmed(0.31, "Cost centre 410"),
      reliability: confirmed(0.97), operator: confirmed("Own"), notes: "Two high-care lines, one high-risk. Weekend shift already in use." }),
    node({ id: "m_wakefield", name: "Wakefield Ambient & Frozen", type: "factory", city: "Wakefield", temperature: "multi",
      capacityPerWeek: confirmed(150_000), inventoryDays: confirmed(6, "WMS"), fixedCostPerYear: confirmed(9_800_000),
      handlingCostPerCase: confirmed(0.26), reliability: confirmed(0.98), operator: confirmed("Own") }),
    // National
    node({ id: "ndc_daventry", name: "Daventry National DC", type: "national_dc", city: "Daventry", temperature: "multi",
      capacityPerWeek: confirmed(300_000, "Dock & chamber capacity study 2024"), inventoryDays: confirmed(4.2, "WMS"),
      fixedCostPerYear: confirmed(11_600_000, "3PL open-book"), handlingCostPerCase: confirmed(0.58, "3PL rate card"),
      reliability: confirmed(0.95), operator: confirmed("3PL – open book"), notes: "Chilled chamber at 94% at Friday peak." }),
    // Regional
    node({ id: "rdc_dartford", name: "Dartford RDC", type: "regional_dc", city: "Dartford", temperature: "chilled",
      capacityPerWeek: confirmed(70_000), inventoryDays: confirmed(2.1), fixedCostPerYear: confirmed(3_900_000),
      handlingCostPerCase: confirmed(0.49), reliability: confirmed(0.93), operator: confirmed("3PL") }),
    node({ id: "rdc_warrington", name: "Warrington RDC", type: "regional_dc", city: "Warrington", temperature: "chilled",
      capacityPerWeek: confirmed(80_000), inventoryDays: confirmed(2.4), fixedCostPerYear: confirmed(3_600_000),
      handlingCostPerCase: confirmed(0.46), reliability: confirmed(0.95), operator: confirmed("3PL") }),
    node({ id: "rdc_bristol", name: "Avonmouth RDC", type: "regional_dc", city: "Avonmouth", temperature: "chilled",
      capacityPerWeek: confirmed(50_000), inventoryDays: userValue(2.5), fixedCostPerYear: userValue(2_900_000, "Lease + labour estimate"),
      handlingCostPerCase: assumed(0.52, "Benchmarked from Dartford"), reliability: assumed(0.93), operator: confirmed("Own") }),
    node({ id: "rdc_glasgow", name: "Glasgow RDC", type: "regional_dc", city: "Glasgow", temperature: "chilled",
      capacityPerWeek: confirmed(40_000), inventoryDays: confirmed(3.0), fixedCostPerYear: confirmed(2_400_000),
      handlingCostPerCase: confirmed(0.55), reliability: confirmed(0.92), operator: confirmed("3PL") }),
    // Channels
    node({ id: "w_foodservice", name: "Northern Foodservice Wholesale", type: "wholesaler", city: "Leeds", temperature: "multi",
      reliability: assumed(0.9), operator: confirmed("Customer-owned") }),
    node({ id: "ecom_daventry", name: "DTC fulfilment (in NDC)", type: "ecom_fc", city: "Daventry", temperature: "chilled",
      capacityPerWeek: userValue(12_000, "Pick-face capacity"), handlingCostPerCase: assumed(2.1, "Each-pick benchmark"),
      reliability: assumed(0.9), operator: confirmed("3PL") }),
    // Customers (retailer DCs / regions)
    node({ id: "c_london", name: "Grocer DCs – London", type: "customer_zone", city: "London", temperature: "multi" }),
    node({ id: "c_kent", name: "Grocer DCs – Kent & Sussex", type: "customer_zone", city: "Brighton", temperature: "multi" }),
    node({ id: "c_manchester", name: "Grocer DCs – Manchester", type: "customer_zone", city: "Manchester", temperature: "multi" }),
    node({ id: "c_leeds", name: "Grocer DCs – Yorkshire", type: "customer_zone", city: "Leeds", temperature: "multi" }),
    node({ id: "c_bristol", name: "Grocer DCs – Bristol", type: "customer_zone", city: "Bristol", temperature: "multi" }),
    node({ id: "c_cardiff", name: "Grocer DCs – South Wales", type: "customer_zone", city: "Cardiff", temperature: "multi" }),
    node({ id: "c_glasgow", name: "Grocer DCs – Glasgow", type: "customer_zone", city: "Glasgow", temperature: "multi" }),
    node({ id: "c_edinburgh", name: "Grocer DCs – Edinburgh", type: "customer_zone", city: "Edinburgh", temperature: "multi" }),
    node({ id: "c_birmingham", name: "Grocer DCs – Birmingham", type: "customer_zone", city: "Birmingham", temperature: "multi" }),
    node({ id: "c_nottingham", name: "Grocer DCs – East Midlands", type: "customer_zone", city: "Nottingham", temperature: "multi" }),
    node({ id: "c_norwich", name: "Grocer DCs – East Anglia", type: "customer_zone", city: "Norwich", temperature: "multi" }),
    node({ id: "c_newcastle", name: "Grocer DCs – North East", type: "customer_zone", city: "Newcastle", temperature: "multi" }),
    node({ id: "c_dublin", name: "Grocer DCs – Ireland", type: "customer_zone", city: "Dublin", temperature: "multi" }),
    node({ id: "c_dtc", name: "DTC home-delivery customers", type: "customer_zone", city: "Milton Keynes", temperature: "chilled", locSource: "user" }),
  ];

  const lanes: Lane[] = [
    // Inbound produce
    lane({ id: "l_sp_farm", from: "f_spalding", to: "m_spalding", temperature: "chilled", families: ["raw_produce"],
      volume: confirmed(42_000, "Goods receipt, 13-wk avg"), cost: confirmed(0.12), transit: confirmed(0.2), reliability: confirmed(0.98), pattern: "milk_run" }),
    lane({ id: "l_ev_farm", from: "f_evesham", to: "m_spalding", temperature: "chilled", families: ["raw_produce"],
      volume: confirmed(31_000, "Goods receipt"), cost: confirmed(0.74), transit: confirmed(0.5), reliability: confirmed(0.94), pattern: "milk_run" }),
    lane({ id: "l_kent_farm", from: "f_kent", to: "m_spalding", temperature: "chilled", families: ["raw_produce"],
      volume: userValue(19_000), transit: assumed(0.6), pattern: "milk_run" }),
    lane({ id: "l_wl_dover", from: "s_westland", to: "p_dover", temperature: "chilled", families: ["raw_produce"],
      volume: confirmed(34_000, "Customs declarations"), cost: confirmed(1.65), transit: confirmed(1.1), reliability: confirmed(0.94), crossesBorder: true }),
    lane({ id: "l_al_dover", from: "s_almeria", to: "p_dover", temperature: "chilled", families: ["raw_produce"],
      volume: confirmed(46_000, "Customs declarations, winter peak 61k"), cost: confirmed(3.9), transit: confirmed(3.2), reliability: confirmed(0.86), crossesBorder: true }),
    lane({ id: "l_dover_sp", from: "p_dover", to: "m_spalding", temperature: "chilled", families: ["raw_produce"],
      volume: confirmed(80_000), cost: confirmed(0.96), transit: confirmed(0.5), reliability: confirmed(0.9) }),
    lane({ id: "l_rot_fx", from: "s_rotterdam", to: "p_felixstowe", mode: "sea", temperature: "ambient", families: ["dry_ingredients"],
      volume: userValue(58_000, "Purchase orders"), cost: assumed(0.55), transit: confirmed(2), reliability: assumed(0.92), crossesBorder: true }),
    lane({ id: "l_fx_wk", from: "p_felixstowe", to: "m_wakefield", temperature: "ambient", families: ["dry_ingredients"],
      volume: userValue(58_000), transit: assumed(1) }),
    lane({ id: "l_lin_wk", from: "s_lincoln", to: "m_wakefield", temperature: "ambient", families: ["dry_ingredients"],
      volume: confirmed(28_000), cost: confirmed(0.41), transit: confirmed(0.5), reliability: confirmed(0.98) }),
    lane({ id: "l_pack_sp", from: "s_pack", to: "m_spalding", temperature: "ambient", families: ["dry_ingredients"],
      volume: assumed(22_000, "Packaging usage ratio 0.13 per case"), transit: confirmed(0.4) }),
    lane({ id: "l_pack_wk", from: "s_pack", to: "m_wakefield", temperature: "ambient", families: ["dry_ingredients"],
      volume: assumed(11_000, "Packaging usage ratio"), transit: confirmed(0.5) }),
    // Factory -> NDC
    lane({ id: "l_sp_ndc", from: "m_spalding", to: "ndc_daventry", temperature: "chilled", families: ["ready_meals", "salads"],
      volume: confirmed(182_000, "Dispatch log 13-wk avg"), cost: confirmed(0.71, "Dedicated fleet"), transit: confirmed(0.4), reliability: confirmed(0.97) }),
    lane({ id: "l_wk_ndc", from: "m_wakefield", to: "ndc_daventry", temperature: "multi", families: ["sauces", "frozen"],
      volume: confirmed(90_500), cost: confirmed(0.84), transit: confirmed(0.5), reliability: confirmed(0.98) }),
    // NDC -> RDCs
    lane({ id: "l_ndc_dart", from: "ndc_daventry", to: "rdc_dartford", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(61_000), cost: confirmed(0.92), transit: confirmed(0.5), reliability: confirmed(0.93) }),
    lane({ id: "l_ndc_warr", from: "ndc_daventry", to: "rdc_warrington", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(52_000), cost: confirmed(0.88), transit: confirmed(0.5), reliability: confirmed(0.95) }),
    lane({ id: "l_ndc_bris", from: "ndc_daventry", to: "rdc_bristol", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(20_000), cost: confirmed(1.21, "Part-loads"), transit: confirmed(0.5), reliability: assumed(0.93) }),
    lane({ id: "l_ndc_glas", from: "ndc_daventry", to: "rdc_glasgow", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(22_000), cost: confirmed(2.35), transit: confirmed(1.0), reliability: confirmed(0.9) }),
    // NDC direct to customers
    lane({ id: "l_ndc_bham", from: "ndc_daventry", to: "c_birmingham", temperature: "multi", families: ["ready_meals", "salads", "sauces", "frozen"],
      volume: confirmed(31_000), cost: confirmed(0.66), transit: confirmed(0.3), reliability: confirmed(0.95), pattern: "direct" }),
    lane({ id: "l_ndc_nott", from: "ndc_daventry", to: "c_nottingham", temperature: "multi", families: ["ready_meals", "salads", "sauces", "frozen"],
      volume: confirmed(18_000), cost: confirmed(0.72), transit: confirmed(0.3), reliability: confirmed(0.95), pattern: "direct" }),
    lane({ id: "l_ndc_norw", from: "ndc_daventry", to: "c_norwich", temperature: "multi", families: ["ready_meals", "salads", "sauces", "frozen"],
      volume: confirmed(14_000), cost: confirmed(1.38, "Poor backload"), transit: confirmed(0.5), reliability: confirmed(0.93), pattern: "direct" }),
    lane({ id: "l_ndc_newc", from: "ndc_daventry", to: "c_newcastle", temperature: "multi", families: ["ready_meals", "sauces", "frozen"],
      volume: confirmed(12_000), cost: confirmed(1.74), transit: confirmed(0.7), reliability: confirmed(0.92), pattern: "direct" }),
    lane({ id: "l_ndc_ws", from: "ndc_daventry", to: "w_foodservice", temperature: "multi", families: ["ready_meals", "sauces", "frozen"],
      volume: confirmed(24_000), cost: confirmed(1.05), transit: confirmed(0.6), reliability: confirmed(0.93) }),
    lane({ id: "l_ndc_ecom", from: "ndc_daventry", to: "ecom_daventry", temperature: "chilled", families: ["ready_meals", "salads"],
      volume: confirmed(7_500, "Order management system"), cost: confirmed(0.05), transit: confirmed(0.1) }),
    lane({ id: "l_ecom_cust", from: "ecom_daventry", to: "c_dtc", mode: "parcel", temperature: "chilled", families: ["ready_meals", "salads"],
      volume: confirmed(7_500), cost: confirmed(6.8, "Carrier invoice, chilled parcel"), transit: confirmed(1.2), reliability: confirmed(0.91), pattern: "last_mile" }),
    lane({ id: "l_ndc_dub", from: "ndc_daventry", to: "c_dublin", mode: "road", temperature: "multi", families: ["ready_meals", "sauces", "frozen"],
      volume: confirmed(11_000), cost: confirmed(3.4, "Via Holyhead, incl. ferry"), transit: confirmed(1.8), reliability: confirmed(0.85), crossesBorder: true }),
    // RDC -> customers
    lane({ id: "l_dart_lon", from: "rdc_dartford", to: "c_london", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(36_000), cost: confirmed(0.58), transit: confirmed(0.3), reliability: confirmed(0.94) }),
    lane({ id: "l_dart_kent", from: "rdc_dartford", to: "c_kent", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(25_000), cost: confirmed(0.69), transit: confirmed(0.3), reliability: confirmed(0.93) }),
    lane({ id: "l_warr_man", from: "rdc_warrington", to: "c_manchester", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(30_000), cost: confirmed(0.49), transit: confirmed(0.2), reliability: confirmed(0.96) }),
    lane({ id: "l_warr_leeds", from: "rdc_warrington", to: "c_leeds", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(22_000), cost: confirmed(0.64), transit: confirmed(0.3), reliability: confirmed(0.95) }),
    lane({ id: "l_bris_bris", from: "rdc_bristol", to: "c_bristol", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(12_000), cost: assumed(0.55), transit: confirmed(0.2) }),
    lane({ id: "l_bris_card", from: "rdc_bristol", to: "c_cardiff", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(8_000), cost: assumed(0.7), transit: confirmed(0.3) }),
    lane({ id: "l_glas_glas", from: "rdc_glasgow", to: "c_glasgow", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(14_000), cost: confirmed(0.52), transit: confirmed(0.2), reliability: confirmed(0.93) }),
    lane({ id: "l_glas_edin", from: "rdc_glasgow", to: "c_edinburgh", temperature: "chilled", families: ["ready_meals", "salads", "sauces"],
      volume: confirmed(8_000), cost: confirmed(0.71), transit: confirmed(0.3), reliability: confirmed(0.92) }),
    // Returns / backhaul
    lane({ id: "l_ret_dart", from: "c_london", to: "rdc_dartford", temperature: "ambient", families: ["returns"],
      volume: assumed(900, "2.5% of outbound, returnable trays"), cost: assumed(0.15, "On existing backhaul"), transit: confirmed(0.3), pattern: "backhaul" }),
  ];

  return {
    id: "food_uk_chilled",
    name: "Fenland Fresh Foods – UK chilled network",
    vertical: "food_manufacturing",
    currency: "GBP",
    description:
      "UK chilled and ambient food manufacturer: five produce suppliers (three UK farms, Netherlands and Spain via Dover), two factories, one multi-temperature national DC in Daventry, four regional DCs, retailer DC customers across the UK and Ireland, a foodservice wholesaler and a small DTC channel.",
    nodes,
    lanes,
    productFamilies: [
      { id: "ready_meals", name: "Chilled ready meals", temperature: "chilled", velocity: "fast",
        shelfLifeDays: confirmed(10, "Spec sheet"), unitValue: confirmed(28.5, "Standard cost"), shareOfVolume: confirmed(0.41), weeklyShrinkRate: confirmed(0.012, "Waste log") },
      { id: "salads", name: "Prepared salads", temperature: "chilled", velocity: "fast",
        shelfLifeDays: confirmed(6, "Spec sheet"), unitValue: confirmed(19.2), shareOfVolume: confirmed(0.26), weeklyShrinkRate: confirmed(0.031, "Waste log") },
      { id: "sauces", name: "Ambient sauces", temperature: "ambient", velocity: "medium",
        shelfLifeDays: confirmed(365), unitValue: confirmed(22.0), shareOfVolume: confirmed(0.24), weeklyShrinkRate: confirmed(0.002) },
      { id: "frozen", name: "Frozen desserts", temperature: "frozen", velocity: "slow",
        shelfLifeDays: confirmed(540), unitValue: confirmed(31.0), shareOfVolume: confirmed(0.09), weeklyShrinkRate: confirmed(0.003) },
      { id: "raw_produce", name: "Fresh produce (raw)", temperature: "chilled", velocity: "fast",
        shelfLifeDays: confirmed(7, "Intake spec"), unitValue: assumed(9.0, "Blended produce cost"), weeklyShrinkRate: assumed(0.045, "Intake rejection + trim") },
      { id: "dry_ingredients", name: "Dry ingredients & packaging", temperature: "ambient", velocity: "medium",
        unitValue: assumed(6.0) },
      { id: "returns", name: "Returnable trays & returns", temperature: "ambient", velocity: "slow", unitValue: assumed(1.0) },
    ],
    regions: [
      { id: "r_scotland", name: "Scotland", nodeIds: ["c_glasgow", "c_edinburgh"], seasonalityPeakFactor: assumed(1.25, "Summer salad peak") },
      { id: "r_north", name: "North of England", nodeIds: ["c_manchester", "c_leeds", "c_newcastle", "w_foodservice"], seasonalityPeakFactor: assumed(1.3) },
      { id: "r_midlands", name: "Midlands & East", nodeIds: ["c_birmingham", "c_nottingham", "c_norwich"], seasonalityPeakFactor: assumed(1.3) },
      { id: "r_southeast", name: "South East", nodeIds: ["c_london", "c_kent", "c_dtc"], seasonalityPeakFactor: confirmed(1.38, "FY24 weekly demand") },
      { id: "r_southwest", name: "South West & Wales", nodeIds: ["c_bristol", "c_cardiff"], seasonalityPeakFactor: assumed(1.35) },
      { id: "r_ireland", name: "Ireland", nodeIds: ["c_dublin"], seasonalityPeakFactor: assumed(1.2) },
    ],
    assumptions: [
      { id: "a1", text: "Lane costs without an invoice are estimated at £0.0062 per case-km (road) plus £0.42 handling per leg.", source: "assumed", sensitivity: "medium" },
      { id: "a2", text: "Summer peak is +38% in the South East (confirmed) and assumed to be +25–35% elsewhere.", source: "assumed", sensitivity: "high", appliesTo: ["r_north", "r_midlands", "r_southwest", "r_scotland"] },
      { id: "a3", text: "Almería remains the sole winter source for salad tomatoes and peppers (Nov–Mar).", source: "user", sensitivity: "high", appliesTo: ["s_almeria"] },
      { id: "a4", text: "Inventory carrying cost is 18% of case value per year.", source: "assumed", sensitivity: "medium" },
      { id: "a5", text: "Shadow carbon price of £85/tCO2e is included as a separate cost line, not in cash cost.", source: "assumed", sensitivity: "low" },
      { id: "a6", text: "Avonmouth RDC handling cost is benchmarked from Dartford; no cost-centre data loaded.", source: "assumed", sensitivity: "low", appliesTo: ["rdc_bristol"] },
    ],
    rules: [
      { id: "ru1", text: "Chilled products must reach retailer DCs with at least 75% of shelf life remaining.", kind: "temperature", active: true, createdBy: "user" },
      { id: "ru2", text: "No node should operate above 85% of rated capacity on an average week.", kind: "capacity", active: true, createdBy: "template" },
      { id: "ru3", text: "Retailer DCs are served by the nearest RDC unless a direct NDC lane is cheaper by more than 10%.", kind: "allocation", active: true, createdBy: "template" },
      { id: "ru4", text: "Target 97.5% case-fill to grocery customers; 95% to foodservice.", kind: "service", active: true, createdBy: "user" },
    ],
    goals: { primary: "cost", secondary: ["resilience", "service"] },
    parameters: defaultParameters(),
  };
}
