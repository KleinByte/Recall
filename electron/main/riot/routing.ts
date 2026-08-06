const ROUTES: Record<string, string> = {
  BR: "americas",
  BR1: "americas",
  LA1: "americas",
  LA2: "americas",
  LAN: "americas",
  LAS: "americas",
  NA: "americas",
  NA1: "americas",
  EUNE: "europe",
  EUN1: "europe",
  EUW: "europe",
  EUW1: "europe",
  RU: "europe",
  TR: "europe",
  TR1: "europe",
  ME: "europe",
  ME1: "europe",
  JP: "asia",
  JP1: "asia",
  KR: "asia",
  OCE: "sea",
  OC1: "sea",
  PH: "sea",
  PH2: "sea",
  SG: "sea",
  SG2: "sea",
  TH: "sea",
  TH2: "sea",
  TW: "sea",
  TW2: "sea",
  VN: "sea",
  VN2: "sea",
}

/** Converts the League client's platform/region into Match-V5 routing. */
export function regionalRouteFor(platform: string): string | undefined {
  return ROUTES[platform.trim().toUpperCase()]
}

const CANONICAL_PLATFORM: Record<string, string> = {
  NA: "NA1", EUW: "EUW1", EUNE: "EUN1", BR: "BR1", LAN: "LA1",
  LAS: "LA2", OCE: "OC1", JP: "JP1", TR: "TR1", PH: "PH2",
  SG: "SG2", TH: "TH2", TW: "TW2", VN: "VN2",
  ME: "ME1",
}

export function canonicalPlatformId(platform: string): string {
  const normalized = platform.trim().toUpperCase()
  return CANONICAL_PLATFORM[normalized] ?? normalized
}
