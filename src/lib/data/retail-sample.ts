import { GAZETTEER, jitter, placeToLocation } from "../domain/geo";
import { assumed, confirmed, defaultParameters, userValue } from "../domain/helpers";
import type { Lane, NetworkModel, NetworkNode } from "../domain/types";

const place = (city: string) => {
  const p = GAZETTEER.find((g) => g.city === city);
  if (!p) throw new Error(`Unknown place ${city}`);
  return p;
};

export function buildRetailSample(): NetworkModel {
  const storeClusters: { id: string; city: string; stores: number; weekly: number; region: string }[] = [
    { id: "st_london", city: "London", stores: 14, weekly: 21_000, region: "South East" },
    { id: "st_reading", city: "Reading", stores: 6, weekly: 8_400, region: "South East" },
    { id: "st_brighton", city: "Brighton", stores: 4, weekly: 5_200, region: "South East" },
    { id: "st_bristol", city: "Bristol", stores: 6, weekly: 7_900, region: "South West" },
    { id: "st_exeter", city: "Exeter", stores: 3, weekly: 3_300, region: "South West" },
    { id: "st_cardiff", city: "Cardiff", stores: 4, weekly: 4_800, region: "Wales" },
    { id: "st_bham", city: "Birmingham", stores: 9, weekly: 12_100, region: "Midlands" },
    { id: "st_nott", city: "Nottingham", stores: 5, weekly: 6_200, region: "Midlands" },
    { id: "st_manc", city: "Manchester", stores: 9, weekly: 12_600, region: "North West" },
    { id: "st_liv", city: "Liverpool", stores: 4, weekly: 5_100, region: "North West" },
    { id: "st_leeds", city: "Leeds", stores: 7, weekly: 9_300, region: "North East" },
    { id: "st_newc", city: "Newcastle", stores: 4, weekly: 4_900, region: "North East" },
    { id: "st_glas", city: "Glasgow", stores: 5, weekly: 6_000, region: "Scotland" },
    { id: "st_edin", city: "Edinburgh", stores: 4, weekly: 4_600, region: "Scotland" },
    { id: "st_aber", city: "Aberdeen", stores: 2, weekly: 1_900, region: "Scotland" },
  ];

  const nodes: NetworkNode[] = [
    { id: "s_shenzhen", name: "Shenzhen electricals & lighting", type: "supplier", temperature: "ambient",
      location: placeToLocation(place("Shenzhen"), "confirmed"), reliability: confirmed(0.9, "Vendor scorecard"), operator: confirmed("Supplier") },
    { id: "s_hcmc", name: "Ho Chi Minh City furniture", type: "supplier", temperature: "ambient",
      location: placeToLocation(place("Ho Chi Minh City"), "confirmed"), reliability: confirmed(0.84, "Vendor scorecard"), operator: confirmed("Supplier"), tags: ["single factory"] },
    { id: "s_mumbai", name: "Mumbai textiles & homeware", type: "supplier", temperature: "ambient",
      location: placeToLocation(place("Mumbai"), "confirmed"), reliability: assumed(0.9), operator: confirmed("Supplier") },
    { id: "s_poznan", name: "Poznań flat-pack furniture", type: "supplier", temperature: "ambient",
      location: placeToLocation(place("Poznań"), "confirmed"), reliability: confirmed(0.95), operator: confirmed("Supplier") },
    { id: "s_evesham", name: "UK garden & plants", type: "farm", temperature: "ambient",
      location: placeToLocation(place("Evesham"), "confirmed"), reliability: assumed(0.92), operator: confirmed("Grower network"), tags: ["seasonal Mar–Jun"] },
    { id: "p_felixstowe", name: "Port of Felixstowe", type: "port", temperature: "ambient",
      location: placeToLocation(place("Felixstowe"), "confirmed"), reliability: confirmed(0.9, "Dwell-time feed"), operator: confirmed("Third party") },
    { id: "p_dover", name: "Dover / Eurotunnel", type: "port", temperature: "ambient",
      location: placeToLocation(place("Dover"), "confirmed"), reliability: confirmed(0.93), operator: confirmed("Third party") },
    { id: "ndc_magna", name: "Magna Park Import Centre & NDC", type: "national_dc", temperature: "ambient",
      location: placeToLocation(place("Lutterworth"), "confirmed"), capacityPerWeek: confirmed(170_000, "Racking + dock study"),
      inventoryDays: confirmed(31, "WMS, slow-moving import stock"), fixedCostPerYear: confirmed(18_900_000), handlingCostPerCase: confirmed(0.74),
      reliability: confirmed(0.96), operator: confirmed("Own") },
    { id: "rdc_donc", name: "Doncaster RDC", type: "regional_dc", temperature: "ambient",
      location: placeToLocation(place("Doncaster"), "confirmed"), capacityPerWeek: confirmed(75_000), inventoryDays: confirmed(9),
      fixedCostPerYear: confirmed(6_200_000), handlingCostPerCase: confirmed(0.61), reliability: confirmed(0.95), operator: confirmed("3PL") },
    { id: "rdc_reading", name: "Reading RDC", type: "regional_dc", temperature: "ambient",
      location: placeToLocation(place("Reading"), "confirmed"), capacityPerWeek: confirmed(60_000), inventoryDays: confirmed(8),
      fixedCostPerYear: confirmed(7_100_000, "High land cost"), handlingCostPerCase: confirmed(0.68), reliability: confirmed(0.94), operator: confirmed("3PL") },
    { id: "fc_mk", name: "Milton Keynes e-commerce FC", type: "ecom_fc", temperature: "ambient",
      location: placeToLocation(place("Milton Keynes"), "confirmed"), capacityPerWeek: confirmed(48_000, "Pick capacity"), inventoryDays: confirmed(14),
      fixedCostPerYear: confirmed(9_400_000), handlingCostPerCase: confirmed(1.9, "Each-pick"), reliability: confirmed(0.93), operator: confirmed("Own") },
    { id: "ret_northampton", name: "Northampton returns centre", type: "returns_center", temperature: "ambient",
      location: placeToLocation(place("Northampton"), "confirmed"), capacityPerWeek: userValue(9_000), handlingCostPerCase: assumed(3.4, "Returns grading benchmark"),
      operator: confirmed("3PL") },
    { id: "mp_online", name: "Marketplace sellers (drop-ship)", type: "wholesaler", temperature: "ambient",
      location: placeToLocation(place("Northampton"), "confirmed"), reliability: assumed(0.88, "No seller SLA data"), operator: confirmed("Third-party sellers"), tags: ["drop-ship"] },
    ...storeClusters.map((s, i) => ({
      id: s.id,
      name: `${s.city} stores (${s.stores})`,
      type: "store" as const,
      temperature: "ambient" as const,
      location: { ...jitter(place(s.city), i + 1, 0.12), city: s.city, region: s.region, country: "GB", source: "confirmed" as const },
      capacityPerWeek: assumed(s.weekly * 1.6, "Backroom capacity rule of thumb"),
      inventoryDays: confirmed(21, "Store stock file"),
      handlingCostPerCase: assumed(1.1, "Store replenishment labour"),
      operator: confirmed("Own"),
      tags: ["click & collect", "ship-from-store"],
    })),
    { id: "cz_south", name: "Online customers – South", type: "customer_zone", temperature: "ambient",
      location: { ...place("Oxford"), source: "assumed" as const, country: "GB", region: "South East" } },
    { id: "cz_north", name: "Online customers – North", type: "customer_zone", temperature: "ambient",
      location: { ...place("Leeds"), source: "assumed" as const, country: "GB", region: "North East" } },
    { id: "cz_scot", name: "Online customers – Scotland", type: "customer_zone", temperature: "ambient",
      location: { ...place("Perth"), source: "assumed" as const, country: "GB", region: "Scotland" } },
  ];

  const lanes: Lane[] = [
    { id: "l_sz_fx", from: "s_shenzhen", to: "p_felixstowe", mode: "sea", temperature: "ambient", productFamilies: ["electricals"],
      volumePerWeek: confirmed(38_000, "Bookings"), costPerCase: confirmed(1.9, "Freight forwarder"), transitDays: confirmed(38), reliability: confirmed(0.78, "Schedule reliability"), crossesBorder: true },
    { id: "l_hcmc_fx", from: "s_hcmc", to: "p_felixstowe", mode: "sea", temperature: "ambient", productFamilies: ["furniture"],
      volumePerWeek: confirmed(21_000), costPerCase: confirmed(3.6), transitDays: confirmed(34), reliability: confirmed(0.8), crossesBorder: true },
    { id: "l_mum_fx", from: "s_mumbai", to: "p_felixstowe", mode: "sea", temperature: "ambient", productFamilies: ["homeware"],
      volumePerWeek: userValue(29_000), costPerCase: assumed(1.6), transitDays: confirmed(24), reliability: assumed(0.85), crossesBorder: true },
    { id: "l_poz_dov", from: "s_poznan", to: "p_dover", mode: "road", temperature: "ambient", productFamilies: ["furniture"],
      volumePerWeek: confirmed(19_000), costPerCase: confirmed(2.4), transitDays: confirmed(3), reliability: confirmed(0.94), crossesBorder: true },
    { id: "l_fx_ndc", from: "p_felixstowe", to: "ndc_magna", mode: "rail", temperature: "ambient", productFamilies: ["electricals", "furniture", "homeware"],
      volumePerWeek: confirmed(88_000), costPerCase: confirmed(0.62, "Intermodal contract"), transitDays: confirmed(1.5), reliability: confirmed(0.92) },
    { id: "l_dov_ndc", from: "p_dover", to: "ndc_magna", mode: "road", temperature: "ambient", productFamilies: ["furniture"],
      volumePerWeek: confirmed(19_000), costPerCase: confirmed(1.1), transitDays: confirmed(0.6), reliability: confirmed(0.93) },
    { id: "l_eve_ndc", from: "s_evesham", to: "ndc_magna", mode: "road", temperature: "ambient", productFamilies: ["garden"],
      volumePerWeek: userValue(19_000, "Peak-season weekly avg"), transitDays: confirmed(0.4) },
    { id: "l_ndc_donc", from: "ndc_magna", to: "rdc_donc", mode: "road", temperature: "ambient", productFamilies: ["electricals", "furniture", "homeware", "garden"],
      volumePerWeek: confirmed(37_200), costPerCase: confirmed(0.78), transitDays: confirmed(0.5), reliability: confirmed(0.95) },
    { id: "l_ndc_read", from: "ndc_magna", to: "rdc_reading", mode: "road", temperature: "ambient", productFamilies: ["electricals", "furniture", "homeware", "garden"],
      volumePerWeek: confirmed(42_300), costPerCase: confirmed(0.74), transitDays: confirmed(0.5), reliability: confirmed(0.94) },
    { id: "l_ndc_mk", from: "ndc_magna", to: "fc_mk", mode: "road", temperature: "ambient", productFamilies: ["electricals", "homeware", "garden"],
      volumePerWeek: confirmed(31_000), costPerCase: confirmed(0.52), transitDays: confirmed(0.3), reliability: confirmed(0.97) },
    { id: "l_ndc_bham", from: "ndc_magna", to: "st_bham", mode: "road", temperature: "ambient", productFamilies: ["electricals", "furniture", "homeware", "garden"],
      volumePerWeek: confirmed(10_100), costPerCase: confirmed(0.9), transitDays: confirmed(0.3), reliability: confirmed(0.95), pattern: "direct" },
    { id: "l_ndc_nott", from: "ndc_magna", to: "st_nott", mode: "road", temperature: "ambient", productFamilies: ["electricals", "furniture", "homeware", "garden"],
      volumePerWeek: confirmed(5_200), costPerCase: confirmed(1.05), transitDays: confirmed(0.3), reliability: confirmed(0.95), pattern: "direct" },
    // RDC Doncaster -> northern stores
    ...[
      ["st_manc", 10_500, 1.12], ["st_liv", 4_300, 1.2], ["st_leeds", 7_800, 0.84], ["st_newc", 4_100, 1.45],
      ["st_glas", 5_000, 2.1], ["st_edin", 3_900, 2.0], ["st_aber", 1_600, 3.1],
    ].map(([to, vol, cost]) => ({
      id: `l_donc_${to}`, from: "rdc_donc", to: to as string, mode: "road" as const, temperature: "ambient" as const,
      productFamilies: ["electricals", "furniture", "homeware", "garden"],
      volumePerWeek: confirmed(vol as number), costPerCase: confirmed(cost as number), transitDays: confirmed(0.5), reliability: confirmed(0.94),
    })),
    // RDC Reading -> southern stores
    ...[
      ["st_london", 17_600, 1.05], ["st_reading", 7_000, 0.6], ["st_brighton", 4_300, 1.1], ["st_bristol", 6_600, 1.0],
      ["st_exeter", 2_800, 1.65], ["st_cardiff", 4_000, 1.3],
    ].map(([to, vol, cost]) => ({
      id: `l_read_${to}`, from: "rdc_reading", to: to as string, mode: "road" as const, temperature: "ambient" as const,
      productFamilies: ["electricals", "furniture", "homeware", "garden"],
      volumePerWeek: confirmed(vol as number), costPerCase: confirmed(cost as number), transitDays: confirmed(0.5), reliability: confirmed(0.93),
    })),
    // E-commerce
    { id: "l_mk_south", from: "fc_mk", to: "cz_south", mode: "parcel", temperature: "ambient", productFamilies: ["electricals", "homeware", "garden"],
      volumePerWeek: confirmed(17_000), costPerCase: confirmed(4.2, "Carrier invoice"), transitDays: confirmed(1.3), reliability: confirmed(0.95), pattern: "last_mile" },
    { id: "l_mk_north", from: "fc_mk", to: "cz_north", mode: "parcel", temperature: "ambient", productFamilies: ["electricals", "homeware", "garden"],
      volumePerWeek: confirmed(10_500), costPerCase: confirmed(4.6), transitDays: confirmed(1.6), reliability: confirmed(0.93), pattern: "last_mile" },
    { id: "l_mk_scot", from: "fc_mk", to: "cz_scot", mode: "parcel", temperature: "ambient", productFamilies: ["electricals", "homeware", "garden"],
      volumePerWeek: confirmed(3_500), costPerCase: confirmed(6.9, "Highlands surcharge"), transitDays: confirmed(2.4), reliability: confirmed(0.88), pattern: "last_mile" },
    // Ship-from-store for bulky furniture
    { id: "l_sfs_london", from: "st_london", to: "cz_south", mode: "van", temperature: "ambient", productFamilies: ["furniture"],
      volumePerWeek: userValue(2_400, "Store order export"), costPerCase: assumed(9.5, "Two-person van benchmark"), transitDays: assumed(2), pattern: "last_mile" },
    { id: "l_sfs_manc", from: "st_manc", to: "cz_north", mode: "van", temperature: "ambient", productFamilies: ["furniture"],
      volumePerWeek: userValue(1_600), costPerCase: assumed(9.5), transitDays: assumed(2), pattern: "last_mile" },
    // Marketplace drop-ship
    { id: "l_mp_south", from: "mp_online", to: "cz_south", mode: "parcel", temperature: "ambient", productFamilies: ["homeware"],
      volumePerWeek: assumed(3_000, "Marketplace GMV / avg basket"), costPerCase: assumed(0, "Borne by seller; commission in margin"), transitDays: assumed(3), pattern: "last_mile" },
    // Returns
    { id: "l_ret_south", from: "cz_south", to: "ret_northampton", mode: "parcel", temperature: "ambient", productFamilies: ["returns"],
      volumePerWeek: confirmed(2_900, "Returns portal, 14%"), costPerCase: confirmed(3.1), transitDays: confirmed(3), pattern: "returns" },
    { id: "l_ret_north", from: "cz_north", to: "ret_northampton", mode: "parcel", temperature: "ambient", productFamilies: ["returns"],
      volumePerWeek: confirmed(1_700), costPerCase: confirmed(3.3), transitDays: confirmed(3), pattern: "returns" },
    { id: "l_ret_ndc", from: "ret_northampton", to: "ndc_magna", mode: "road", temperature: "ambient", productFamilies: ["returns"],
      volumePerWeek: assumed(3_200, "70% graded A/B restocked"), costPerCase: assumed(0.3, "Backhaul"), transitDays: confirmed(0.5), pattern: "backhaul" },
  ];

  return {
    id: "retail_uk_omni",
    name: "Northbridge Home – UK omnichannel network",
    vertical: "retail_ecommerce",
    currency: "GBP",
    description:
      "Import-led UK home & garden retailer: Asian and European suppliers via Felixstowe and Dover, a national import centre at Magna Park, two regional DCs, 86 stores in 15 clusters, a Milton Keynes e-commerce FC with parcel delivery, ship-from-store for bulky furniture, marketplace drop-ship, and a returns centre.",
    nodes,
    lanes,
    productFamilies: [
      { id: "electricals", name: "Electricals & lighting", temperature: "ambient", velocity: "fast", unitValue: confirmed(62), shareOfVolume: confirmed(0.3), weeklyShrinkRate: confirmed(0.001) },
      { id: "furniture", name: "Furniture (bulky)", temperature: "ambient", velocity: "slow", unitValue: confirmed(140), shareOfVolume: confirmed(0.2), weeklyShrinkRate: confirmed(0.002, "Damage") },
      { id: "homeware", name: "Homeware & textiles", temperature: "ambient", velocity: "medium", unitValue: confirmed(34), shareOfVolume: confirmed(0.35), weeklyShrinkRate: confirmed(0.001) },
      { id: "garden", name: "Garden & plants (seasonal)", temperature: "ambient", velocity: "fast", shelfLifeDays: userValue(21, "Live plants"), unitValue: userValue(18), shareOfVolume: confirmed(0.15), weeklyShrinkRate: assumed(0.05, "Plant losses") },
      { id: "returns", name: "Customer returns", temperature: "ambient", velocity: "slow", unitValue: assumed(30) },
    ],
    regions: [
      { id: "r_south", name: "South", nodeIds: ["st_london", "st_reading", "st_brighton", "st_bristol", "st_exeter", "st_cardiff", "cz_south"], seasonalityPeakFactor: confirmed(1.6, "Nov–Dec peak") },
      { id: "r_midlands", name: "Midlands", nodeIds: ["st_bham", "st_nott"], seasonalityPeakFactor: confirmed(1.55) },
      { id: "r_north", name: "North", nodeIds: ["st_manc", "st_liv", "st_leeds", "st_newc", "cz_north"], seasonalityPeakFactor: confirmed(1.55) },
      { id: "r_scotland", name: "Scotland", nodeIds: ["st_glas", "st_edin", "st_aber", "cz_scot"], seasonalityPeakFactor: assumed(1.5) },
    ],
    assumptions: [
      { id: "a1", text: "Store-cluster volumes are aggregated from the store stock file; individual store addresses are approximated to the cluster city.", source: "assumed", sensitivity: "low" },
      { id: "a2", text: "Ship-from-store van cost is £9.50 per case (two-person crew benchmark); no carrier invoices loaded.", source: "assumed", sensitivity: "medium" },
      { id: "a3", text: "Marketplace drop-ship delivery cost is borne by sellers and captured through commission, so it is excluded from cost-to-serve.", source: "user", sensitivity: "low" },
      { id: "a4", text: "Peak (weeks 44–51) demand is 1.5–1.6x average; capacity checks use average weeks unless a seasonal scenario is applied.", source: "assumed", sensitivity: "high" },
      { id: "a5", text: "Inventory carrying cost is 18% of case value per year; import stock holds 31 days at Magna Park.", source: "assumed", sensitivity: "medium" },
    ],
    rules: [
      { id: "ru1", text: "Stores are replenished at least twice weekly from their assigned RDC.", kind: "service", active: true, createdBy: "template" },
      { id: "ru2", text: "Bulky furniture orders within 25 miles of a store are fulfilled ship-from-store.", kind: "allocation", active: true, createdBy: "user" },
      { id: "ru3", text: "E-commerce next-day promise applies to England and Wales only.", kind: "service", active: true, createdBy: "user" },
      { id: "ru4", text: "No node should operate above 85% of rated capacity on an average week.", kind: "capacity", active: true, createdBy: "template" },
    ],
    goals: { primary: "service", secondary: ["cost", "emissions"] },
    parameters: defaultParameters(),
  };
}
