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
