import type { GeoLocation, Provenance } from "./types";

export interface GazetteerEntry {
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  aliases?: string[];
}

/**
 * Small offline gazetteer so the agent can place nodes without a geocoding API.
 * A production build would swap this for a geocoding connector (see lib/integrations).
 */
export const GAZETTEER: GazetteerEntry[] = [
  // UK
  { city: "London", region: "South East", country: "GB", lat: 51.5074, lng: -0.1278 },
  { city: "Birmingham", region: "Midlands", country: "GB", lat: 52.4862, lng: -1.8904 },
  { city: "Manchester", region: "North West", country: "GB", lat: 53.4808, lng: -2.2426 },
  { city: "Leeds", region: "North East", country: "GB", lat: 53.8008, lng: -1.5491 },
  { city: "Sheffield", region: "North East", country: "GB", lat: 53.3811, lng: -1.4701 },
  { city: "Newcastle", region: "North East", country: "GB", lat: 54.9783, lng: -1.6178 },
  { city: "Liverpool", region: "North West", country: "GB", lat: 53.4084, lng: -2.9916 },
  { city: "Bristol", region: "South West", country: "GB", lat: 51.4545, lng: -2.5879 },
  { city: "Exeter", region: "South West", country: "GB", lat: 50.7184, lng: -3.5339 },
  { city: "Plymouth", region: "South West", country: "GB", lat: 50.3755, lng: -4.1427 },
  { city: "Cardiff", region: "Wales", country: "GB", lat: 51.4816, lng: -3.1791 },
  { city: "Swansea", region: "Wales", country: "GB", lat: 51.6214, lng: -3.9436 },
  { city: "Glasgow", region: "Scotland", country: "GB", lat: 55.8642, lng: -4.2518 },
  { city: "Edinburgh", region: "Scotland", country: "GB", lat: 55.9533, lng: -3.1883 },
  { city: "Aberdeen", region: "Scotland", country: "GB", lat: 57.1497, lng: -2.0943 },
  { city: "Inverness", region: "Scotland", country: "GB", lat: 57.4778, lng: -4.2247 },
  { city: "Belfast", region: "Northern Ireland", country: "GB", lat: 54.5973, lng: -5.9301 },
  { city: "Nottingham", region: "Midlands", country: "GB", lat: 52.9548, lng: -1.1581 },
  { city: "Leicester", region: "Midlands", country: "GB", lat: 52.6369, lng: -1.1398 },
  { city: "Coventry", region: "Midlands", country: "GB", lat: 52.4068, lng: -1.5197 },
  { city: "Derby", region: "Midlands", country: "GB", lat: 52.9225, lng: -1.4746 },
  { city: "Stoke-on-Trent", region: "Midlands", country: "GB", lat: 53.0027, lng: -2.1794, aliases: ["stoke"] },
  { city: "Northampton", region: "Midlands", country: "GB", lat: 52.2405, lng: -0.9027 },
  { city: "Milton Keynes", region: "South East", country: "GB", lat: 52.0406, lng: -0.7594 },
  { city: "Daventry", region: "Midlands", country: "GB", lat: 52.2577, lng: -1.1628, aliases: ["dirft"] },
  { city: "Rugby", region: "Midlands", country: "GB", lat: 52.3709, lng: -1.2649 },
  { city: "Lutterworth", region: "Midlands", country: "GB", lat: 52.4566, lng: -1.2018, aliases: ["magna park"] },
  { city: "Doncaster", region: "North East", country: "GB", lat: 53.5228, lng: -1.1285 },
  { city: "Wakefield", region: "North East", country: "GB", lat: 53.683, lng: -1.4977 },
  { city: "Warrington", region: "North West", country: "GB", lat: 53.39, lng: -2.5976 },
  { city: "Preston", region: "North West", country: "GB", lat: 53.7632, lng: -2.7031 },
  { city: "Carlisle", region: "North West", country: "GB", lat: 54.8925, lng: -2.9329 },
  { city: "Peterborough", region: "East", country: "GB", lat: 52.5695, lng: -0.2405 },
  { city: "Norwich", region: "East", country: "GB", lat: 52.6309, lng: 1.2974 },
  { city: "Cambridge", region: "East", country: "GB", lat: 52.2053, lng: 0.1218 },
  { city: "Ipswich", region: "East", country: "GB", lat: 52.0567, lng: 1.1482 },
  { city: "Spalding", region: "East", country: "GB", lat: 52.7875, lng: -0.1528 },
  { city: "Boston", region: "East", country: "GB", lat: 52.9789, lng: -0.0266 },
  { city: "Lincoln", region: "East", country: "GB", lat: 53.2307, lng: -0.5406 },
  { city: "King's Lynn", region: "East", country: "GB", lat: 52.7517, lng: 0.3951, aliases: ["kings lynn"] },
  { city: "Evesham", region: "Midlands", country: "GB", lat: 52.0922, lng: -1.9475 },
  { city: "Hereford", region: "Midlands", country: "GB", lat: 52.0565, lng: -2.7160 },
  { city: "Kent", region: "South East", country: "GB", lat: 51.2787, lng: 0.5217, aliases: ["maidstone"] },
  { city: "Dover", region: "South East", country: "GB", lat: 51.1279, lng: 1.3134 },
  { city: "Felixstowe", region: "East", country: "GB", lat: 51.9617, lng: 1.3513 },
  { city: "Southampton", region: "South East", country: "GB", lat: 50.9097, lng: -1.4044 },
  { city: "Portsmouth", region: "South East", country: "GB", lat: 50.8198, lng: -1.088 },
  { city: "Brighton", region: "South East", country: "GB", lat: 50.8225, lng: -0.1372 },
  { city: "Reading", region: "South East", country: "GB", lat: 51.4543, lng: -0.9781 },
  { city: "Oxford", region: "South East", country: "GB", lat: 51.752, lng: -1.2577 },
  { city: "Swindon", region: "South West", country: "GB", lat: 51.5558, lng: -1.7797 },
  { city: "Avonmouth", region: "South West", country: "GB", lat: 51.5035, lng: -2.6989 },
  { city: "Dartford", region: "South East", country: "GB", lat: 51.4464, lng: 0.2177 },
  { city: "Tilbury", region: "South East", country: "GB", lat: 51.4622, lng: 0.3581, aliases: ["london gateway"] },
  { city: "Hull", region: "North East", country: "GB", lat: 53.7676, lng: -0.3274 },
  { city: "Grimsby", region: "North East", country: "GB", lat: 53.5675, lng: -0.0802, aliases: ["immingham"] },
  { city: "Teesside", region: "North East", country: "GB", lat: 54.5742, lng: -1.2349, aliases: ["middlesbrough"] },
  { city: "Perth", region: "Scotland", country: "GB", lat: 56.3950, lng: -3.4308 },
  { city: "Dundee", region: "Scotland", country: "GB", lat: 56.462, lng: -2.9707 },
  { city: "Holyhead", region: "Wales", country: "GB", lat: 53.3097, lng: -4.633 },
  // Ireland
  { city: "Dublin", region: "Ireland", country: "IE", lat: 53.3498, lng: -6.2603 },
  { city: "Cork", region: "Ireland", country: "IE", lat: 51.8985, lng: -8.4756 },
  // Europe
  { city: "Rotterdam", region: "Netherlands", country: "NL", lat: 51.9244, lng: 4.4777 },
  { city: "Amsterdam", region: "Netherlands", country: "NL", lat: 52.3676, lng: 4.9041 },
  { city: "Venlo", region: "Netherlands", country: "NL", lat: 51.3704, lng: 6.1724 },
  { city: "Westland", region: "Netherlands", country: "NL", lat: 51.9957, lng: 4.2016 },
  { city: "Antwerp", region: "Belgium", country: "BE", lat: 51.2194, lng: 4.4025 },
  { city: "Calais", region: "France", country: "FR", lat: 50.9513, lng: 1.8587 },
  { city: "Paris", region: "France", country: "FR", lat: 48.8566, lng: 2.3522 },
  { city: "Lyon", region: "France", country: "FR", lat: 45.764, lng: 4.8357 },
  { city: "Perpignan", region: "France", country: "FR", lat: 42.6887, lng: 2.8948 },
  { city: "Almería", region: "Spain", country: "ES", lat: 36.834, lng: -2.4637, aliases: ["almeria"] },
  { city: "Murcia", region: "Spain", country: "ES", lat: 37.9922, lng: -1.1307 },
  { city: "Valencia", region: "Spain", country: "ES", lat: 39.4699, lng: -0.3763 },
  { city: "Barcelona", region: "Spain", country: "ES", lat: 41.3874, lng: 2.1686 },
  { city: "Madrid", region: "Spain", country: "ES", lat: 40.4168, lng: -3.7038 },
  { city: "Lisbon", region: "Portugal", country: "PT", lat: 38.7223, lng: -9.1393 },
  { city: "Milan", region: "Italy", country: "IT", lat: 45.4642, lng: 9.19 },
  { city: "Bologna", region: "Italy", country: "IT", lat: 44.4949, lng: 11.3426 },
  { city: "Hamburg", region: "Germany", country: "DE", lat: 53.5511, lng: 9.9937 },
  { city: "Frankfurt", region: "Germany", country: "DE", lat: 50.1109, lng: 8.6821 },
  { city: "Munich", region: "Germany", country: "DE", lat: 48.1351, lng: 11.582 },
  { city: "Cologne", region: "Germany", country: "DE", lat: 50.9375, lng: 6.9603 },
  { city: "Duisburg", region: "Germany", country: "DE", lat: 51.4344, lng: 6.7623 },
  { city: "Warsaw", region: "Poland", country: "PL", lat: 52.2297, lng: 21.0122 },
  { city: "Poznań", region: "Poland", country: "PL", lat: 52.4064, lng: 16.9252, aliases: ["poznan"] },
  { city: "Gdańsk", region: "Poland", country: "PL", lat: 54.352, lng: 18.6466, aliases: ["gdansk"] },
  { city: "Copenhagen", region: "Denmark", country: "DK", lat: 55.6761, lng: 12.5683 },
  { city: "Aarhus", region: "Denmark", country: "DK", lat: 56.1629, lng: 10.2039 },
  { city: "Oslo", region: "Norway", country: "NO", lat: 59.9139, lng: 10.7522 },
  { city: "Stockholm", region: "Sweden", country: "SE", lat: 59.3293, lng: 18.0686 },
  { city: "Vienna", region: "Austria", country: "AT", lat: 48.2082, lng: 16.3738 },
  { city: "Zurich", region: "Switzerland", country: "CH", lat: 47.3769, lng: 8.5417 },
  { city: "Prague", region: "Czechia", country: "CZ", lat: 50.0755, lng: 14.4378 },
  { city: "Budapest", region: "Hungary", country: "HU", lat: 47.4979, lng: 19.0402 },
  { city: "Athens", region: "Greece", country: "GR", lat: 37.9838, lng: 23.7275 },
  { city: "Istanbul", region: "Türkiye", country: "TR", lat: 41.0082, lng: 28.9784 },
  { city: "Casablanca", region: "Morocco", country: "MA", lat: 33.5731, lng: -7.5898 },
  { city: "Agadir", region: "Morocco", country: "MA", lat: 30.4278, lng: -9.5981 },
  // Rest of world (import origins)
  { city: "Shanghai", region: "China", country: "CN", lat: 31.2304, lng: 121.4737 },
  { city: "Shenzhen", region: "China", country: "CN", lat: 22.5431, lng: 114.0579 },
  { city: "Ho Chi Minh City", region: "Vietnam", country: "VN", lat: 10.8231, lng: 106.6297, aliases: ["saigon"] },
  { city: "Mumbai", region: "India", country: "IN", lat: 19.076, lng: 72.8777 },
  { city: "Chennai", region: "India", country: "IN", lat: 13.0827, lng: 80.2707 },
  { city: "Dhaka", region: "Bangladesh", country: "BD", lat: 23.8103, lng: 90.4125 },
  { city: "São Paulo", region: "Brazil", country: "BR", lat: -23.5505, lng: -46.6333, aliases: ["sao paulo"] },
  { city: "Santos", region: "Brazil", country: "BR", lat: -23.9608, lng: -46.3336 },
  { city: "Nairobi", region: "Kenya", country: "KE", lat: -1.2921, lng: 36.8219 },
  { city: "Cape Town", region: "South Africa", country: "ZA", lat: -33.9249, lng: 18.4241 },
  { city: "New York", region: "US East", country: "US", lat: 40.7128, lng: -74.006 },
  { city: "Chicago", region: "US Midwest", country: "US", lat: 41.8781, lng: -87.6298 },
  { city: "Los Angeles", region: "US West", country: "US", lat: 34.0522, lng: -118.2437 },
  { city: "Dallas", region: "US South", country: "US", lat: 32.7767, lng: -96.797 },
  { city: "Atlanta", region: "US South", country: "US", lat: 33.749, lng: -84.388 },
  { city: "Toronto", region: "Canada", country: "CA", lat: 43.6532, lng: -79.3832 },
];

export const UK_REGIONS = [
  "Scotland",
  "North East",
  "North West",
  "Midlands",
  "Wales",
  "East",
  "South East",
  "South West",
  "Northern Ireland",
];

export function findPlace(text: string): GazetteerEntry | undefined {
  const t = text.toLowerCase();
  let best: GazetteerEntry | undefined;
  let bestLen = 0;
  for (const g of GAZETTEER) {
    const names = [g.city, ...(g.aliases ?? [])];
    for (const n of names) {
      const nl = n.toLowerCase();
      if (t.includes(nl) && nl.length > bestLen) {
        best = g;
        bestLen = nl.length;
      }
    }
  }
  return best;
}

export function findRegion(text: string): string | undefined {
  const t = text.toLowerCase();
  const map: Record<string, string> = {
    "south east": "South East",
    southeast: "South East",
    "south west": "South West",
    southwest: "South West",
    "north east": "North East",
    northeast: "North East",
    "north west": "North West",
    northwest: "North West",
    midlands: "Midlands",
    scotland: "Scotland",
    wales: "Wales",
    "northern ireland": "Northern Ireland",
    "east anglia": "East",
    "the east": "East",
    london: "South East",
    north: "North East",
    south: "South East",
  };
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of keys) if (t.includes(k)) return map[k];
  return undefined;
}

export function placeToLocation(p: GazetteerEntry, source: Provenance = "ai"): GeoLocation {
  return { lat: p.lat, lng: p.lng, city: p.city, region: p.region, country: p.country, source };
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Road distance is typically ~1.25x great-circle distance. */
export function roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return haversineKm(a, b) * 1.25;
}

export function jitter(loc: { lat: number; lng: number }, seed: number, spread = 0.35) {
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  const r1 = s - Math.floor(s);
  const s2 = Math.sin(seed * 7919 + 1301) * 233280;
  const r2 = s2 - Math.floor(s2);
  return { lat: loc.lat + (r1 - 0.5) * spread, lng: loc.lng + (r2 - 0.5) * spread * 1.6 };
}
