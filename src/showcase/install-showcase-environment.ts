/** Development-only product showcase data used for documentation captures. */

import {
  recentMatchDurationSecs,
  recentMatchTimelineEvents,
  recentMatchTimelineFrames,
  recentMatchTurningPoints,
} from "./recent-match-timeline"

const SHOWCASE_GAME_ID = 9_100_042
const SHOWCASE_NOW = Date.UTC(2026, 7, 18, 23, 20)
const OWNER_PUUID = "showcase-owner-puuid"
const OWNER_RIOT_ID = "riverquartz#demo"

const champions = [
  { id: 20, alias: "Nunu", name: "Nunu & Willump", roles: ["tank", "mage"], primaryArchetype: "vanguard", isVisibleInClient: true },
  { id: 103, alias: "Ahri", name: "Ahri", roles: ["mage", "assassin"], primaryArchetype: "burst_mage", isVisibleInClient: true },
  { id: 203, alias: "Kindred", name: "Kindred", roles: ["marksman"], primaryArchetype: "marksman", isVisibleInClient: true },
  { id: 104, alias: "Graves", name: "Graves", roles: ["marksman", "fighter"], primaryArchetype: "specialist", isVisibleInClient: true },
  { id: 86, alias: "Garen", name: "Garen", roles: ["fighter", "tank"], primaryArchetype: "juggernaut", isVisibleInClient: true },
  { id: 99, alias: "Lux", name: "Lux", roles: ["mage", "support"], primaryArchetype: "burst_mage", isVisibleInClient: true },
  { id: 51, alias: "Caitlyn", name: "Caitlyn", roles: ["marksman"], primaryArchetype: "marksman", isVisibleInClient: true },
  { id: 40, alias: "Janna", name: "Janna", roles: ["support", "mage"], primaryArchetype: "enchanter", isVisibleInClient: true },
  { id: 122, alias: "Darius", name: "Darius", roles: ["fighter", "tank"], primaryArchetype: "juggernaut", isVisibleInClient: true },
  { id: 64, alias: "LeeSin", name: "Lee Sin", roles: ["fighter", "assassin"], primaryArchetype: "diver", isVisibleInClient: true },
  { id: 7, alias: "Leblanc", name: "LeBlanc", roles: ["assassin", "mage"], primaryArchetype: "burst_mage", isVisibleInClient: true },
  { id: 145, alias: "Kaisa", name: "Kai'Sa", roles: ["marksman", "mage"], primaryArchetype: "marksman", isVisibleInClient: true },
  { id: 111, alias: "Nautilus", name: "Nautilus", roles: ["tank", "support"], primaryArchetype: "vanguard", isVisibleInClient: true },
] as const

const emptySummary = {
  games: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  avgKills: 0,
  avgDeaths: 0,
  avgAssists: 0,
  kda: 0,
  avgDamageToChampions: 0,
  avgDamageTaken: 0,
  avgGold: 0,
  avgDurationSecs: 0,
  pentaKills: 0,
  currentStreak: 0,
  longestWinStreak: 0,
  gradedGames: 0,
}

const summary = {
  games: 184,
  wins: 103,
  losses: 81,
  winRate: 103 / 184,
  avgKills: 6.8,
  avgDeaths: 4.7,
  avgAssists: 9.4,
  kda: 3.45,
  avgDamageToChampions: 22_460,
  avgDamageTaken: 25_180,
  avgGold: 12_430,
  avgDurationSecs: 1_774,
  pentaKills: 1,
  currentStreak: 4,
  longestWinStreak: 7,
  averageRecallScore: 64.8,
  gradedGames: 172,
}

function match(overrides: Record<string, unknown> = {}) {
  return {
    gameId: SHOWCASE_GAME_ID,
    puuid: OWNER_PUUID,
    queueId: 420,
    queueName: "Ranked Solo/Duo",
    gameMode: "CLASSIC",
    mode: "sr_ranked_solo",
    modeFamily: "sr",
    isRanked: 1,
    isMatched: 1,
    playedAt: SHOWCASE_NOW,
    durationSecs: recentMatchDurationSecs,
    gameVersion: "16.14.1.8012",
    mapId: 11,
    resolvedPosition: "JUNGLE",
    positionResolverVersion: 3,
    championId: 20,
    win: 1,
    kills: 7,
    deaths: 2,
    assists: 14,
    champLevel: 16,
    goldEarned: 12_984,
    damageToChampions: 18_742,
    damageTaken: 31_508,
    damageSelfMitigated: 27_306,
    totalHeal: 13_860,
    totalUnitsHealed: 5,
    timeCcingOthers: 42,
    largestKillingSpree: 5,
    largestMultiKill: 2,
    doubleKills: 1,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    totalMinionsKilled: 38,
    neutralMinions: 142,
    visionScore: 31,
    wardsPlaced: 10,
    wardsKilled: 5,
    controlWards: 3,
    damageObjectives: 24_810,
    damageTurrets: 2_140,
    turretKills: 1,
    inhibitorKills: 0,
    firstBlood: 0,
    endedInSurrender: 0,
    endedInEarlySurrender: 0,
    csPerMin: 5.8,
    goldPerMin: 421,
    grade: "A+",
    gradeScore: 0.86,
    recallScore: 86,
    gradeStatus: "ready",
    gradeRecipeId: "recall-v3-showcase",
    gradeEvidenceCoverage: 0.96,
    gradeReferenceSampleCount: 68,
    lobbyPlace: 1,
    lobbySize: 10,
    ...overrides,
  }
}

const recentMatches = [
  match(),
  match({ gameId: SHOWCASE_GAME_ID - 1, playedAt: SHOWCASE_NOW - 3_600_000, championId: 203, kills: 9, deaths: 4, assists: 8, grade: "A", recallScore: 79, durationSecs: 1_692 }),
  match({ gameId: SHOWCASE_GAME_ID - 2, playedAt: SHOWCASE_NOW - 7_400_000, championId: 104, win: 0, kills: 5, deaths: 7, assists: 6, grade: "B", recallScore: 61, durationSecs: 1_955 }),
  match({ gameId: SHOWCASE_GAME_ID - 3, playedAt: SHOWCASE_NOW - 86_400_000, championId: 103, kills: 11, deaths: 3, assists: 10, grade: "S-", recallScore: 91, resolvedPosition: "MIDDLE", durationSecs: 1_812 }),
  match({ gameId: SHOWCASE_GAME_ID - 4, playedAt: SHOWCASE_NOW - 90_000_000, championId: 20, kills: 4, deaths: 3, assists: 17, grade: "A-", recallScore: 76, durationSecs: 1_744 }),
  match({ gameId: SHOWCASE_GAME_ID - 5, playedAt: SHOWCASE_NOW - 172_800_000, championId: 99, win: 0, kills: 3, deaths: 6, assists: 9, grade: "B+", recallScore: 68, resolvedPosition: "UTILITY", durationSecs: 1_623 }),
  match({ gameId: SHOWCASE_GAME_ID - 6, playedAt: SHOWCASE_NOW - 180_000_000, championId: 20, kills: 8, deaths: 1, assists: 12, grade: "S", recallScore: 94, durationSecs: 1_565 }),
  match({ gameId: SHOWCASE_GAME_ID - 7, playedAt: SHOWCASE_NOW - 259_200_000, championId: 203, win: 0, kills: 7, deaths: 6, assists: 5, grade: "B", recallScore: 59, durationSecs: 2_040 }),
  match({ gameId: SHOWCASE_GAME_ID - 8, playedAt: SHOWCASE_NOW - 345_600_000, championId: 20, kills: 6, deaths: 4, assists: 13, grade: "A", recallScore: 82, durationSecs: 1_801 }),
  match({ gameId: SHOWCASE_GAME_ID - 9, playedAt: SHOWCASE_NOW - 432_000_000, championId: 104, kills: 10, deaths: 5, assists: 7, grade: "A-", recallScore: 75, durationSecs: 1_904 }),
]

const participantSeeds = [
  [1, 100, 86, "Topiary#DEMO", "TOP", 3, 5, 7, 6, 12, 13_104, 19_460],
  [2, 100, 20, "RiverQuartz#DEMO", "JUNGLE", 11, 4, 7, 2, 14, 12_984, 18_742],
  [3, 100, 103, "PaperComet#DEMO", "MIDDLE", 4, 14, 8, 3, 11, 14_102, 28_306],
  [4, 100, 51, "SoftSignal#DEMO", "BOTTOM", 4, 7, 10, 4, 9, 15_630, 31_490],
  [5, 100, 40, "BlueLantern#DEMO", "UTILITY", 4, 3, 1, 4, 22, 9_412, 8_266],
  [6, 200, 122, "IronOrchid#DEMO", "TOP", 4, 12, 4, 8, 5, 11_283, 22_178],
  [7, 200, 64, "RedCurrent#DEMO", "JUNGLE", 11, 4, 5, 6, 7, 11_946, 17_332],
  [8, 200, 7, "QuietNova#DEMO", "MIDDLE", 4, 14, 7, 7, 6, 12_340, 24_990],
  [9, 200, 145, "GlassKite#DEMO", "BOTTOM", 4, 7, 8, 7, 5, 13_586, 27_214],
  [10, 200, 111, "StoneBell#DEMO", "UTILITY", 4, 14, 2, 8, 12, 8_990, 7_801],
] as const

const scoreboard = participantSeeds.map((seed, index) => {
  const [participantId, teamId, championId, summonerName, resolvedPosition, spell1Id, spell2Id, kills, deaths, assists, goldEarned, damageToChampions] = seed
  return {
    gameId: SHOWCASE_GAME_ID,
    participantPuuid: participantId === 2 ? OWNER_PUUID : `showcase-player-${participantId}`,
    puuid: participantId === 2 ? OWNER_PUUID : `showcase-player-${participantId}`,
    participantId,
    teamId,
    isPlayer: participantId === 2 ? 1 : 0,
    championId,
    win: teamId === 100 ? 1 : 0,
    summonerName,
    profileIcon: 29,
    spell1Id,
    spell2Id,
    items: teamId === 100 ? [2504, 3110, 3065, 3047, 3067, 0, 3364] : [6692, 3071, 3053, 3111, 0, 0, 3340],
    perkPrimaryStyle: 8400,
    perkSubStyle: 8300,
    perks: [],
    champLevel: index < 5 ? 16 : 15,
    kills,
    deaths,
    assists,
    goldEarned,
    goldSpent: goldEarned - 420,
    damageToChampions,
    totalDamageDealt: damageToChampions * 4,
    magicDamageToChampions: Math.round(damageToChampions * 0.44),
    physicalDamageToChampions: Math.round(damageToChampions * 0.5),
    trueDamageToChampions: Math.round(damageToChampions * 0.06),
    damageTaken: 19_000 + index * 1_620,
    damageSelfMitigated: 8_400 + index * 1_190,
    totalHeal: participantId === 2 ? 13_860 : 2_200,
    totalUnitsHealed: participantId === 5 ? 5 : 1,
    timeCcingOthers: 12 + index * 3,
    largestKillingSpree: Math.max(1, kills - 2),
    largestMultiKill: kills >= 8 ? 2 : 1,
    doubleKills: kills >= 8 ? 1 : 0,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    totalMinionsKilled: resolvedPosition === "JUNGLE" ? 38 : 130 + index * 7,
    neutralMinions: resolvedPosition === "JUNGLE" ? 142 : 4,
    visionScore: resolvedPosition === "UTILITY" ? 48 : 18 + index,
    wardsPlaced: 8 + index,
    wardsKilled: 2 + (index % 4),
    controlWards: 1 + (index % 3),
    damageObjectives: resolvedPosition === "JUNGLE" ? 24_810 : 4_600,
    damageTurrets: 1_200 + index * 140,
    turretKills: index % 3 === 0 ? 1 : 0,
    inhibitorKills: 0,
    longestTimeLiving: 710,
    firstBlood: 0,
    firstTower: 0,
    recallScore: [64, 86, 81, 78, 74, 55, 63, 59, 60, 52][index],
    grade: ["B+", "A+", "A", "A-", "A-", "C+", "B", "B-", "B", "C+"][index],
    gradeStatus: "ready",
    gradeReferenceSampleCount: 68,
    resolvedPosition,
    positionResolverVersion: 3,
    augments: [],
  }
})

const teams = [
  { gameId: SHOWCASE_GAME_ID, puuid: OWNER_PUUID, teamId: 100, win: 1, bans: "[24,78,555,421,238]", baronKills: 1, dragonKills: 3, heraldKills: 1, hordeKills: 3, towerKills: 9, inhibitorKills: 2, firstBlood: 1, firstTower: 1, firstBaron: 1, firstDragon: 0, firstInhibitor: 1 },
  { gameId: SHOWCASE_GAME_ID, puuid: OWNER_PUUID, teamId: 200, win: 0, bans: "[53,89,120,163,221]", baronKills: 0, dragonKills: 1, heraldKills: 0, hordeKills: 0, towerKills: 3, inhibitorKills: 0, firstBlood: 0, firstTower: 0, firstBaron: 0, firstDragon: 1, firstInhibitor: 0 },
]

function liveItem(itemId: number, name: string, price: number) {
  return { itemId, name, count: 1, price, canUse: false, consumable: false }
}

function livePlayer(
  championName: string,
  riotId: string,
  team: "ORDER" | "CHAOS",
  scores: { kills: number; deaths: number; assists: number; creepScore: number; wardScore: number },
  items: ReturnType<typeof liveItem>[],
  options: { local?: boolean; level?: number; dead?: boolean } = {},
) {
  return {
    championName,
    riotId,
    team,
    level: options.level ?? 14,
    isDead: options.dead ?? false,
    respawnTimer: options.dead ? 18 : 0,
    isLocal: options.local ?? false,
    scores,
    items,
    summonerSpells: ["Flash", championName === "Nunu & Willump" || championName === "Lee Sin" ? "Smite" : ""].filter(Boolean),
  }
}

const liveAllies = [
  livePlayer("Garen", "Topiary#DEMO", "ORDER", { kills: 4, deaths: 3, assists: 6, creepScore: 151, wardScore: 14 }, [liveItem(3078, "Trinity Force", 3333), liveItem(3047, "Plated Steelcaps", 1200)]),
  livePlayer("Nunu & Willump", "RiverQuartz#DEMO", "ORDER", { kills: 6, deaths: 2, assists: 12, creepScore: 132, wardScore: 26 }, [liveItem(2504, "Kaenic Rookern", 2900), liveItem(3110, "Frozen Heart", 2500), liveItem(3047, "Plated Steelcaps", 1200)], { local: true, level: 15 }),
  livePlayer("Ahri", "PaperComet#DEMO", "ORDER", { kills: 8, deaths: 4, assists: 9, creepScore: 166, wardScore: 17 }, [liveItem(6655, "Luden's Companion", 2850), liveItem(3020, "Sorcerer's Shoes", 1100)]),
  livePlayer("Caitlyn", "SoftSignal#DEMO", "ORDER", { kills: 9, deaths: 5, assists: 7, creepScore: 184, wardScore: 12 }, [liveItem(3031, "Infinity Edge", 3450), liveItem(6672, "Kraken Slayer", 3100)]),
  livePlayer("Janna", "BlueLantern#DEMO", "ORDER", { kills: 1, deaths: 3, assists: 21, creepScore: 29, wardScore: 48 }, [liveItem(6617, "Moonstone Renewer", 2200), liveItem(3158, "Ionian Boots of Lucidity", 900)]),
]

const liveEnemies = [
  livePlayer("Darius", "IronOrchid#DEMO", "CHAOS", { kills: 5, deaths: 6, assists: 4, creepScore: 159, wardScore: 11 }, [liveItem(3071, "Black Cleaver", 3000), liveItem(3111, "Mercury's Treads", 1250)]),
  livePlayer("Lee Sin", "RedCurrent#DEMO", "CHAOS", { kills: 6, deaths: 7, assists: 8, creepScore: 126, wardScore: 21 }, [liveItem(6630, "Stridebreaker", 3300), liveItem(3053, "Sterak's Gage", 3200)]),
  livePlayer("LeBlanc", "QuietNova#DEMO", "CHAOS", { kills: 7, deaths: 7, assists: 5, creepScore: 151, wardScore: 14 }, [liveItem(6655, "Luden's Companion", 2850), liveItem(4645, "Shadowflame", 3200)]),
  livePlayer("Kai'Sa", "GlassKite#DEMO", "CHAOS", { kills: 8, deaths: 8, assists: 6, creepScore: 176, wardScore: 10 }, [liveItem(6672, "Kraken Slayer", 3100), liveItem(3124, "Guinsoo's Rageblade", 3000)], { dead: true }),
  livePlayer("Nautilus", "StoneBell#DEMO", "CHAOS", { kills: 2, deaths: 5, assists: 18, creepScore: 32, wardScore: 43 }, [liveItem(3190, "Locket of the Iron Solari", 2200), liveItem(3047, "Plated Steelcaps", 1200)]),
]

function tempoAnalysis(
  score: number,
  label: "Surging" | "Building" | "Stable" | "Slipping" | "Collapsing" |
    "Double Kill" | "Triple Kill" | "Quadra Kill" | "Pentakill",
  direction: "up" | "steady" | "down",
  surgeTier?: "gold" | "emerald" | "diamond" | "master",
) {
  return {
    score,
    label,
    direction,
    leadDelta: score >= 100 ? 2_400 : 620,
    factors: score >= 100
      ? [label, "Objective pressure", "Gold lead growing"]
      : direction === "down"
        ? ["Fight window closed", "Lead stabilizing"]
        : ["Two recent picks", "Dragon secured", "Gold lead growing"],
    ...(surgeTier ? { surgeTier } : {}),
  }
}

function liveSessionWithTempo(tempo = tempoAnalysis(78, "Building", "up")) {
  return {
    phase: "InProgress",
    gameId: SHOWCASE_GAME_ID,
    queueId: 420,
    queueName: "Ranked Solo/Duo",
    mode: "sr_ranked_solo",
    gameMode: "CLASSIC",
    mapId: 11,
    localPlayerCellId: 1,
    benchChampionIds: [],
    allies: [
      { cellId: 0, championId: 86, championPickIntent: 86, displayName: "Topiary#DEMO", assignedPosition: "TOP" },
      { cellId: 1, championId: 20, championPickIntent: 20, displayName: "RiverQuartz#DEMO", puuid: OWNER_PUUID, assignedPosition: "JUNGLE" },
      { cellId: 2, championId: 103, championPickIntent: 103, displayName: "PaperComet#DEMO", assignedPosition: "MIDDLE" },
      { cellId: 3, championId: 51, championPickIntent: 51, displayName: "SoftSignal#DEMO", assignedPosition: "BOTTOM" },
      { cellId: 4, championId: 40, championPickIntent: 40, displayName: "BlueLantern#DEMO", assignedPosition: "UTILITY" },
    ],
    enemies: [],
    game: {
      available: true,
      gameTime: 1_124,
      gameMode: "CLASSIC",
      mapName: "Summoner's Rift",
      mapNumber: 11,
      localTeam: "ORDER",
      activePlayer: {
        riotId: "RiverQuartz#DEMO",
        championName: "Nunu & Willump",
        currentGold: 1_420,
        level: 15,
        abilityHaste: 37,
      },
      allies: liveAllies,
      enemies: liveEnemies,
      events: [
        { id: 91, name: "DragonKill", time: 1_071, killerName: "RiverQuartz#DEMO", assisters: ["PaperComet#DEMO", "BlueLantern#DEMO"], result: "ORDER" },
        { id: 92, name: "ChampionKill", time: 1_101, killerName: "SoftSignal#DEMO", victimName: "GlassKite#DEMO", assisters: ["RiverQuartz#DEMO"], result: "ORDER" },
        { id: 93, name: "ChampionKill", time: 1_108, killerName: "RiverQuartz#DEMO", victimName: "RedCurrent#DEMO", assisters: ["PaperComet#DEMO"], result: "ORDER", multiKill: 2 },
      ],
      analysis: {
        resources: { allyGold: 48_700, enemyGold: 45_950, difference: 2_750, quality: "strong", source: "estimated" },
        winConfidence: { percent: 61, label: "Favored", factors: ["Gold lead", "Dragon control", "Recent fight"] },
        tempo,
      },
      updatedAt: SHOWCASE_NOW,
    },
    updatedAt: SHOWCASE_NOW,
  }
}

let currentLiveSession = liveSessionWithTempo()

const localKey = `ally:riot:${OWNER_RIOT_ID}`
const minimapParticipants = [
  { participantKey: localKey, championName: "Nunu & Willump", team: "ally", isLocal: true },
  { participantKey: "ally:riot:papercomet#demo", championName: "Ahri", team: "ally", isLocal: false },
  { participantKey: "ally:riot:softsignal#demo", championName: "Caitlyn", team: "ally", isLocal: false },
  { participantKey: "enemy:riot:redcurrent#demo", championName: "Lee Sin", team: "enemy", isLocal: false },
  { participantKey: "enemy:riot:quietnova#demo", championName: "LeBlanc", team: "enemy", isLocal: false },
] as const

const minimapSegments = [
  {
    gameId: SHOWCASE_GAME_ID,
    participantKey: localKey,
    startTimeMs: 82_000,
    endTimeMs: 244_000,
    kind: "observed",
    points: [
      { x: 0.105, y: 0.86 }, { x: 0.205, y: 0.62 }, { x: 0.266, y: 0.468 },
      { x: 0.158, y: 0.434 }, { x: 0.267, y: 0.563 }, { x: 0.39, y: 0.59 },
      { x: 0.481, y: 0.638 }, { x: 0.535, y: 0.733 }, { x: 0.572, y: 0.818 },
    ],
    confidence: 0.94,
    modelVersion: 3,
  },
  {
    gameId: SHOWCASE_GAME_ID,
    participantKey: "ally:riot:papercomet#demo",
    startTimeMs: 170_000,
    endTimeMs: 255_000,
    kind: "observed",
    points: [{ x: 0.26, y: 0.75 }, { x: 0.39, y: 0.63 }, { x: 0.52, y: 0.51 }, { x: 0.61, y: 0.44 }],
    confidence: 0.89,
    modelVersion: 3,
  },
  {
    gameId: SHOWCASE_GAME_ID,
    participantKey: "ally:riot:softsignal#demo",
    startTimeMs: 165_000,
    endTimeMs: 255_000,
    kind: "observed",
    points: [{ x: 0.2, y: 0.88 }, { x: 0.36, y: 0.77 }, { x: 0.54, y: 0.66 }, { x: 0.68, y: 0.61 }],
    confidence: 0.86,
    modelVersion: 3,
  },
  {
    gameId: SHOWCASE_GAME_ID,
    participantKey: "enemy:riot:redcurrent#demo",
    startTimeMs: 185_000,
    endTimeMs: 252_000,
    kind: "observed",
    points: [{ x: 0.79, y: 0.27 }, { x: 0.7, y: 0.39 }, { x: 0.61, y: 0.51 }, { x: 0.55, y: 0.58 }],
    confidence: 0.83,
    modelVersion: 3,
  },
  {
    gameId: SHOWCASE_GAME_ID,
    participantKey: "enemy:riot:quietnova#demo",
    startTimeMs: 206_000,
    endTimeMs: 244_000,
    kind: "inferred",
    points: [{ x: 0.72, y: 0.26 }, { x: 0.63, y: 0.38 }, { x: 0.57, y: 0.46 }],
    confidence: 0.76,
    inferenceMode: "smoothed_postgame",
    modelVersion: 3,
  },
] as const

const clearDefinitions = [
  ["west_blue", 104_000, 374_000],
  ["west_gromp", 132_000, 252_000],
  ["west_wolves", 159_000, 279_000],
  ["west_raptors", 184_000, 304_000],
  ["west_red", 211_000, 481_000],
  ["west_krugs", 230_000, 350_000],
] as const

const campClears = clearDefinitions.map(([campKey, clearedAtMs, respawnAtMs], routeIndex) => ({
  gameId: SHOWCASE_GAME_ID,
  puuid: OWNER_PUUID,
  campKey,
  clearedAtMs,
  respawnAtMs,
  source: "minimap_cv",
  sourceConfidence: 0.9 + routeIndex * 0.008,
  attribution: "local",
  attributionConfidence: 0.91,
  evidence: {
    campTransition: true,
    localPositionObserved: true,
    localPositionDistance: 0.018,
    expectedNextCamp: true,
    transitionConfidence: 0.92,
  },
  routeIndex,
  algorithmVersion: 6,
}))

const minimapReview = {
  analysis: {
    analysisId: "showcase-analysis",
    gameId: SHOWCASE_GAME_ID,
    puuid: OWNER_PUUID,
    inputHash: "showcase-only",
    graphVersion: 3,
    modelVersion: 3,
    status: "complete",
    coverage: { observed: 0.82 },
    createdAt: SHOWCASE_NOW,
    completedAt: SHOWCASE_NOW + 300,
  },
  participants: minimapParticipants,
  segments: minimapSegments,
  campClears,
}

function aggregate(score: number, source: "role_fit" | "career_arm_mean" = "role_fit") {
  const coverage = { eligibleGames: 68, observedGames: 64, gameRatio: 0.94, eligibleWeight: 68, observedWeight: 64, weightRatio: 0.94 }
  return source === "role_fit"
    ? {
        source,
        score,
        nEff: 52,
        confidence: "established",
        coverage,
        confidenceInterval95: { method: "deterministic_match_bootstrap_percentile", confidenceLevel: 0.95, lower: score - 4, upper: score + 4, replicates: 500, seed: 42, observedGames: 64 },
      }
    : { source, score, nEff: 52, confidence: "established", coverage, availableArms: 8, totalArms: 8, armCoverage: 1, evidenceCoverage: 0.94 }
}

function dimension(
  key: string,
  label: string,
  score: number,
  recentScore: number,
  description: string,
  options: { careerOnly?: boolean; responsibilityWeight?: number } = {},
) {
  return {
    key,
    label,
    shortLabel: label,
    description,
    score,
    recentScore,
    delta: recentScore - score,
    games: 68,
    eligibleGames: 68,
    coverage: 0.94,
    effectiveGames: 52,
    confidence: "established",
    responsibilityWeight: options.responsibilityWeight ?? (1 / 7),
    headlineEligible: true,
    careerOnly: options.careerOnly ?? false,
    metrics: [{
      key: `${key}_primary`,
      label: `${label} contribution`,
      score,
      rawValue: score,
      unit: "score",
      tier: "CORE",
      weight: 1,
      vectorWeight: 1,
      gradeInfluence: options.careerOnly ? 0 : (options.responsibilityWeight ?? (1 / 7)),
      influence: options.careerOnly ? 0 : (options.responsibilityWeight ?? (1 / 7)),
      games: 68,
      eligibleGames: 68,
      coverage: 0.94,
      effectiveGames: 52,
      evidenceState: "observed",
      description,
      formula: "Mode and role adjusted percentile",
      comparison: "Compared with similar recorded games",
      referenceMatchCount: 68,
    }],
  }
}

const performanceProfile = {
  recipeId: "recall-v3-showcase",
  scoringContext: "profile",
  weighting: { kind: "half_life", halfLifeMs: 7_776_000_000, referenceTime: SHOWCASE_NOW },
  score: 72,
  recallScoreAverage: 64.8,
  headline: aggregate(72, "career_arm_mean"),
  scopes: {
    overall: { kind: "overall", key: "overall", score: 72, headline: aggregate(72), games: 68, measuredGames: 64, coverage: 0.94, confidence: "established" },
    positions: [{ kind: "position", key: "JUNGLE", position: "JUNGLE", score: 76, headline: aggregate(76), games: 51, measuredGames: 49, coverage: 0.96, confidence: "established" }],
    primaryArchetypes: [{ kind: "primary_archetype", key: "vanguard", primaryArchetype: "vanguard", score: 74, headline: aggregate(74), games: 37, measuredGames: 35, coverage: 0.95, confidence: "established" }],
  },
  games: 68,
  recentGames: 20,
  measuredGames: 64,
  coverage: 0.94,
  confidence: "established",
  comparison: "Compared with similar recorded Summoner's Rift games",
  dimensions: [
    dimension("combat", "Combat", 76, 82, "Damage, takedowns, and fight conversion."),
    dimension("positioning_survival", "Survival", 68, 73, "Deaths, durability, and positioning outcomes."),
    dimension("control_utility", "Utility", 79, 84, "Vision, crowd control, and team enablement."),
    dimension("economy", "Economy", 71, 79, "Gold, farm, and advantages over the opposing role."),
    dimension("objectives_macro", "Macro", 74, 80, "Structures, neutral objectives, and map conversion."),
    dimension("vision_setup", "Vision", 66, 75, "Creating and denying vision around important areas."),
    dimension("initiative_pressure", "Initiative", 82, 88, "Early movement, takedowns, and pressure."),
    dimension("consistency_versatility", "Range", 73, 77, "Consistency and breadth across champions and positions.", { careerOnly: true, responsibilityWeight: 0 }),
  ],
  strongestKey: "initiative_pressure",
  growthKey: "positioning_survival",
}

const matchPerformance = {
  ...performanceProfile,
  scoringContext: "match",
  score: 86,
  games: 1,
  recentGames: 1,
  measuredGames: 1,
  dimensions: [
    dimension("combat", "Combat", 84, 76, "Damage, takedowns, and fight conversion.", { responsibilityWeight: 0.18 }),
    dimension("positioning_survival", "Survival", 91, 68, "Deaths, durability, and positioning outcomes.", { responsibilityWeight: 0.16 }),
    dimension("control_utility", "Utility", 82, 79, "Vision, crowd control, and team enablement.", { responsibilityWeight: 0.16 }),
    dimension("economy", "Economy", 88, 71, "Gold, farm, and advantages over the opposing role.", { responsibilityWeight: 0.14 }),
    dimension("objectives_macro", "Macro", 86, 74, "Structures, neutral objectives, and map conversion.", { responsibilityWeight: 0.16 }),
    dimension("vision_setup", "Vision", 77, 66, "Creating and denying vision around important areas.", { responsibilityWeight: 0.08 }),
    dimension("initiative_pressure", "Initiative", 89, 82, "Early movement, takedowns, and pressure.", { responsibilityWeight: 0.12 }),
  ],
}

const review = {
  match: match(),
  records: [
    { key: "fastest_full_clear", label: "Fastest full clear", category: "Timeline", format: "duration", value: 230, gameId: SHOWCASE_GAME_ID, championId: 20, playedAt: SHOWCASE_NOW, mode: "sr_ranked_solo", source: "timeline" },
    { key: "objective_damage", label: "Objective damage", category: "Objectives", format: "compact", value: 24_810, gameId: SHOWCASE_GAME_ID, championId: 20, playedAt: SHOWCASE_NOW, mode: "sr_ranked_solo", source: "scoreboard" },
  ],
  scoreboard,
  teams,
  labels: [
    { id: "comeback_king", name: "Comeback king", category: "momentum", polarity: "positive", tooltip: "Recovered from an early deficit and finished from the winning side.", evidence: { largestDeficit: -2_180, finalLead: 8_620 }, source: "timeline", confidence: "strong", priority: 96 },
    { id: "counter_jungler", name: "Counter jungler", category: "jungle", polarity: "positive", tooltip: "Converted enemy-side camps into a meaningful jungle farm edge.", evidence: { enemyCamps: 7, neutralMinions: 142 }, source: "timeline", confidence: "strong", priority: 93 },
    { id: "objective_control", name: "Objective control", category: "objectives", polarity: "positive", tooltip: "Converted pathing into neutral objective pressure.", evidence: { objectiveDamage: 24_810, dragons: 3 }, source: "timeline", confidence: "strong", priority: 88 },
    { id: "efficient_pathing", name: "Efficient pathing", category: "jungle", polarity: "positive", tooltip: "Completed a fast first clear with strong observed coverage.", evidence: { clearTime: "3:50", evidence: "92%" }, source: "timeline", confidence: "strong", priority: 84 },
  ],
  grade: {
    recipeId: "recall-v3-showcase",
    recallScore: 86,
    lobbyPercentile: 0.94,
    compositePercentile: 0.86,
    components: [
      { key: "combat", label: "Combat", percentile: 0.84, weight: 0.18, contribution: 0.1512, scope: "role" },
      { key: "positioning_survival", label: "Survival", percentile: 0.91, weight: 0.16, contribution: 0.1456, scope: "role" },
      { key: "control_utility", label: "Utility", percentile: 0.82, weight: 0.16, contribution: 0.1312, scope: "role" },
      { key: "economy", label: "Economy", percentile: 0.88, weight: 0.14, contribution: 0.1232, scope: "role" },
      { key: "objectives_macro", label: "Macro", percentile: 0.86, weight: 0.16, contribution: 0.1376, scope: "role" },
      { key: "vision_setup", label: "Vision", percentile: 0.77, weight: 0.08, contribution: 0.0616, scope: "role" },
      { key: "initiative_pressure", label: "Initiative", percentile: 0.89, weight: 0.12, contribution: 0.1068, scope: "role" },
    ],
  },
  baseline: {
    scope: "champion_mode",
    games: 23,
    confidence: "solid",
    metrics: [
      { key: "deaths", label: "Deaths", current: 2, baseline: 4.1, difference: -2.1, preferredDirection: "lower", evidenceGames: 23, robustScale: 1.2, effect: 1.75 },
      { key: "objective_damage", label: "Objective damage", current: 24_810, baseline: 15_900, difference: 8_910, preferredDirection: "higher", evidenceGames: 23, robustScale: 4_200, effect: 2.12 },
    ],
  },
  highlights: [
    { kind: "strength", title: "Objective pacing", detail: "This was one of your strongest objective games on Nunu.", metricKey: "objectives_macro" },
    { kind: "improvement", title: "Stayed alive", detail: "You died less than your recent Nunu baseline.", metricKey: "deaths" },
  ],
  annotation: { gameId: SHOWCASE_GAME_ID, note: "Review the first dragon setup and repeat this opening route.", bookmarked: true, tags: [{ id: 1, name: "Clean clear", color: "#5ccfe6" }] },
  timeline: {
    status: "ready",
    fetchedAt: SHOWCASE_NOW + 10_000,
    summary: {
      frames: recentMatchTimelineFrames,
      events: recentMatchTimelineEvents,
      turningPoints: recentMatchTurningPoints,
    },
  },
}

const rankingRows = [
  { championId: 20, games: 37, gradedGames: 36, winRate: 0.62, kda: 4.18, recallScore: 74, confidence: "solid" },
  { championId: 203, games: 22, gradedGames: 21, winRate: 0.59, kda: 3.44, recallScore: 70, confidence: "solid" },
  { championId: 104, games: 18, gradedGames: 18, winRate: 0.56, kda: 3.12, recallScore: 67, confidence: "solid" },
  { championId: 103, games: 15, gradedGames: 15, winRate: 0.6, kda: 3.68, recallScore: 72, confidence: "solid" },
  { championId: 99, games: 11, gradedGames: 10, winRate: 0.55, kda: 3.2, recallScore: 65, confidence: "solid" },
] as const

const championStats = rankingRows.map((row) => ({
  championId: row.championId,
  games: row.games,
  wins: Math.round(row.games * row.winRate),
  losses: row.games - Math.round(row.games * row.winRate),
  winRate: row.winRate,
  avgKills: 6.4,
  avgDeaths: 4.2,
  avgAssists: 9.1,
  kda: row.kda,
  averageRecallScore: row.recallScore,
  gradedGames: row.gradedGames,
}))

const profile = {
  challenges: {
    overallLevel: "Diamond",
    totalScore: 8_640,
    percentile: 7.4,
    categoryJson: JSON.stringify([
      { category: "TEAMWORK", current: 1_840, max: 2_200, level: "Diamond", positionPercentile: 7.2 },
      { category: "EXPERTISE", current: 1_720, max: 2_000, level: "Diamond", positionPercentile: 8.1 },
      { category: "IMAGINATION", current: 1_360, max: 1_900, level: "Platinum", positionPercentile: 12.4 },
    ]),
  },
  ranked: { queueMap: { RANKED_SOLO_5x5: { tier: "EMERALD", division: "I", leaguePoints: 74, wins: 103, losses: 81 } } },
  mastery: rankingRows.map((row, index) => ({ championId: row.championId, championLevel: index < 3 ? 12 : 8, championPoints: 214_000 - index * 27_000, highestGrade: index === 0 ? "S+" : "S" })),
}

const challenges = [
  { challengeId: 101, puuid: OWNER_PUUID, name: "Jungle Diff", description: "Win games as the jungler.", category: "EXPERTISE", idListType: "CHAMPION", gameModes: "CLASSIC", currentLevel: "PLATINUM", nextLevel: "DIAMOND", currentValue: 91, currentThreshold: 75, nextThreshold: 100, thresholds: "{}", percentile: 8.2, pointsAwarded: 60, isCapstone: 0, isApex: 0, isRetired: 0, parentId: null, iconPath: null, completedIds: "[]", updatedAt: SHOWCASE_NOW },
  { challengeId: 102, puuid: OWNER_PUUID, name: "Flawless Victory", description: "Win without dying.", category: "TEAMWORK", idListType: "CHAMPION", gameModes: "CLASSIC", currentLevel: "GOLD", nextLevel: "PLATINUM", currentValue: 18, currentThreshold: 12, nextThreshold: 20, thresholds: "{}", percentile: 12.7, pointsAwarded: 40, isCapstone: 0, isApex: 0, isRetired: 0, parentId: null, iconPath: null, completedIds: "[]", updatedAt: SHOWCASE_NOW },
  { challengeId: 103, puuid: OWNER_PUUID, name: "Invincible", description: "Win games with no deaths and at least 30% kill participation.", category: "VETERANCY", idListType: "CHAMPION", gameModes: "CLASSIC", currentLevel: "PLATINUM", nextLevel: "DIAMOND", currentValue: 44, currentThreshold: 35, nextThreshold: 50, thresholds: "{}", percentile: 6.9, pointsAwarded: 60, isCapstone: 0, isApex: 0, isRetired: 0, parentId: null, iconPath: null, completedIds: "[]", updatedAt: SHOWCASE_NOW },
]

const rankedHistory = [{
  queue: "RANKED_SOLO_5x5",
  points: [
    { recordedAt: SHOWCASE_NOW - 28 * 86_400_000, points: 2_975, label: "PLATINUM I", leaguePoints: 75, wins: 78, losses: 70 },
    { recordedAt: SHOWCASE_NOW - 18 * 86_400_000, points: 3_120, label: "EMERALD IV", leaguePoints: 20, wins: 85, losses: 73 },
    { recordedAt: SHOWCASE_NOW - 9 * 86_400_000, points: 3_285, label: "EMERALD II", leaguePoints: 35, wins: 94, losses: 77 },
    { recordedAt: SHOWCASE_NOW - 3_600_000, points: 3_374, label: "EMERALD I", leaguePoints: 74, wins: 103, losses: 81 },
  ],
}]

const clearSamples = [
  { gameId: SHOWCASE_GAME_ID, championId: 20, playedAt: SHOWCASE_NOW, win: 1, clearTimeMs: 230_000, route: clearDefinitions.map(([key]) => key), confidence: 0.92 },
  { gameId: SHOWCASE_GAME_ID - 4, championId: 20, playedAt: SHOWCASE_NOW - 90_000_000, win: 1, clearTimeMs: 221_000, route: ["west_red", "west_krugs", "west_raptors", "west_wolves", "west_blue", "west_gromp"], confidence: 0.9 },
  { gameId: SHOWCASE_GAME_ID - 6, championId: 20, playedAt: SHOWCASE_NOW - 180_000_000, win: 1, clearTimeMs: 211_000, route: clearDefinitions.map(([key]) => key), confidence: 0.95 },
  { gameId: SHOWCASE_GAME_ID - 8, championId: 20, playedAt: SHOWCASE_NOW - 345_600_000, win: 0, clearTimeMs: 242_000, route: ["west_red", "west_raptors", "west_wolves", "west_blue", "west_gromp", "west_krugs"], confidence: 0.86 },
] as const

const skillArmSeeds = [
  ["combat", "Combat", 0.18],
  ["positioning_survival", "Survival", 0.16],
  ["control_utility", "Utility", 0.16],
  ["economy", "Economy", 0.14],
  ["objectives_macro", "Macro", 0.16],
  ["vision_setup", "Vision", 0.08],
  ["initiative_pressure", "Initiative", 0.12],
] as const

function showcaseGrade(score: number) {
  if (score >= 90) return "S"
  if (score >= 84) return "A+"
  if (score >= 78) return "A"
  if (score >= 72) return "A-"
  if (score >= 66) return "B+"
  if (score >= 60) return "B"
  return "C+"
}

const skillHistory = Array.from({ length: 32 }, (_, index) => {
  const score = Math.round(Math.max(52, Math.min(96,
    59 + index * 0.68 + Math.sin(index * 1.7) * 8 + (index % 5 === 0 ? 6 : 0),
  )))
  return {
    gameId: SHOWCASE_GAME_ID - 200 + index,
    playedAt: SHOWCASE_NOW - (31 - index) * 36_000_000,
    championId: [20, 203, 20, 104, 20, 103, 20, 203][index % 8],
    role: index % 6 === 5 ? "MIDDLE" : "JUNGLE",
    win: score >= 68 || index % 7 === 0,
    grade: showcaseGrade(score),
    recallScore: score,
    durationSecs: 1_480 + index % 9 * 71,
    session: Math.floor(index / 4) + 1,
    sessionGame: index % 4 + 1,
    restMinutes: index % 4 === 0 ? 620 : 28 + index % 3 * 14,
  }
})

const skillGradeComponents = skillHistory.slice(-24).map((game, gameIndex) => {
  const components = skillArmSeeds.map(([key, label, weight], armIndex) => {
    const percentile = Math.max(0.38, Math.min(0.97,
      0.58 + gameIndex * 0.009 + Math.sin(gameIndex * 0.72 + armIndex * 1.3) * 0.16 + armIndex * 0.012,
    ))
    return {
      key,
      label,
      percentile,
      weight,
      contribution: percentile * weight,
      scope: key === "economy" || key === "positioning_survival" ? "role" : "lobby",
    }
  })
  return {
    gameId: game.gameId,
    playedAt: game.playedAt,
    win: game.win,
    championId: game.championId,
    role: game.role,
    grade: game.grade,
    recallScore: game.recallScore,
    session: game.session,
    sessionGame: game.sessionGame,
    restMinutes: game.restMinutes,
    compositePercentile: game.recallScore / 100,
    components,
  }
})

function insightSection(
  key: string,
  title: string,
  method: string,
  findings: Array<Record<string, unknown>>,
) {
  return {
    key,
    title,
    method,
    eligible: true,
    neededGames: 20,
    observedGames: 32,
    window: { label: "32 selected games", limit: 60, recentGames: 16, priorGames: 16 },
    findings,
  }
}

const skillReport = {
  generatedAt: SHOWCASE_NOW,
  scope: { modes: ["sr_ranked_solo"], family: "sr" },
  overview: {
    summary,
    performance: performanceProfile,
    deathMap: {
      timelineGames: 24,
      deaths: Array.from({ length: 38 }, (_, index) => ({
        gameId: skillHistory[index % skillHistory.length].gameId,
        playedAt: skillHistory[index % skillHistory.length].playedAt,
        timestamp: 410_000 + index % 9 * 145_000,
        x: 3_100 + index % 6 * 1_580 + (index % 3) * 220,
        y: 3_500 + index % 5 * 1_720 + (index % 4) * 180,
      })),
    },
    grades: [
      { grade: "S", count: 5 }, { grade: "A+", count: 8 }, { grade: "A", count: 12 },
      { grade: "A-", count: 16 }, { grade: "B+", count: 13 }, { grade: "B", count: 9 },
      { grade: "C+", count: 5 },
    ],
    lobby: {
      games: 64,
      metrics: [
        { key: "role_gold", label: "Gold versus role", averageRank: 3.8, percentile: 0.68, scope: "role", games: 64 },
        { key: "role_kda", label: "KDA versus role", averageRank: 3.4, percentile: 0.73, scope: "role", games: 64 },
        { key: "objective", label: "Objective damage", averageRank: 2.7, percentile: 0.81, scope: "lobby", games: 61 },
        { key: "vision", label: "Vision score", averageRank: 4.1, percentile: 0.62, scope: "lobby", games: 64 },
      ],
    },
    contribution: { games: 64, damageShare: 0.184, goldShare: 0.208, killShare: 0.226 },
    outcomes: {
      duration: [
        { label: "Under 25m", games: 28, wins: 19, winRate: 0.679 },
        { label: "25–30m", games: 62, wins: 37, winRate: 0.597 },
        { label: "30–35m", games: 55, wins: 29, winRate: 0.527 },
        { label: "35m+", games: 39, wins: 18, winRate: 0.462 },
      ],
      hours: [
        { label: "Morning", games: 22, wins: 14, winRate: 0.636 },
        { label: "Afternoon", games: 59, wins: 34, winRate: 0.576 },
        { label: "Evening", games: 81, wins: 46, winRate: 0.568 },
        { label: "Late night", games: 22, wins: 9, winRate: 0.409 },
      ],
      weekdays: [
        { label: "Mon", games: 24, wins: 14, winRate: 0.583 },
        { label: "Tue", games: 29, wins: 18, winRate: 0.621 },
        { label: "Wed", games: 26, wins: 15, winRate: 0.577 },
        { label: "Thu", games: 31, wins: 18, winRate: 0.581 },
        { label: "Fri", games: 32, wins: 17, winRate: 0.531 },
        { label: "Sat", games: 25, wins: 13, winRate: 0.52 },
        { label: "Sun", games: 17, wins: 8, winRate: 0.471 },
      ],
    },
    pool: {
      champions: 5,
      games: 184,
      coreShare: 0.72,
      top: [
        { championId: 20, games: 72, wins: 46 },
        { championId: 203, games: 37, wins: 22 },
        { championId: 104, games: 24, wins: 13 },
        { championId: 103, games: 18, wins: 11 },
      ],
    },
    builds: [
      { itemId: 2504, games: 41 }, { itemId: 3110, games: 38 },
      { itemId: 3065, games: 29 }, { itemId: 3047, games: 54 },
    ],
  },
  visuals: {
    history: skillHistory,
    gradeComponents: skillGradeComponents,
    windows: {
      history: { label: "Latest 32 matches", shownGames: 32, totalGames: 184, limit: 60 },
      gradeComponents: { label: "Latest 24 measured matches", shownGames: 24, limit: 24 },
    },
    champions: [
      { championId: 20, games: 72, wins: 46, winRate: 0.639, kda: 4.28, averageRecallScore: 78.4, gradedGames: 68 },
      { championId: 203, games: 37, wins: 22, winRate: 0.595, kda: 3.62, averageRecallScore: 72.8, gradedGames: 35 },
      { championId: 104, games: 24, wins: 13, winRate: 0.542, kda: 3.11, averageRecallScore: 67.3, gradedGames: 23 },
      { championId: 103, games: 18, wins: 11, winRate: 0.611, kda: 3.79, averageRecallScore: 75.1, gradedGames: 17 },
      { championId: 99, games: 11, wins: 6, winRate: 0.545, kda: 3.2, averageRecallScore: 65.2, gradedGames: 10 },
    ],
  },
  insights: {
    bestGamePattern: insightSection("bestGamePattern", "Best-game pattern", "Top-quarter games compared with the rest", [
      { key: "early_objective", title: "Early objective control", summary: "Games with an early objective had higher Recall Scores.", evidenceLevel: "comparative", confidence: "high", games: 18, eligibleGames: 64, effect: 7.8, unit: "grade", scoreScale: "recall_score_0_100", interval: { low: 3.4, high: 12.1, level: 0.95 }, scope: "18 games with an early objective vs 46 without" },
    ]),
    conditions: insightSection("conditions", "Play conditions", "Sessions and local start times compared", [
      { key: "session:first", title: "First game of a session", summary: "Opening games in a session scored higher than later games.", evidenceLevel: "comparative", confidence: "medium", games: 21, eligibleGames: 62, effect: 4.6, unit: "grade", scoreScale: "recall_score_0_100", interval: { low: 1.1, high: 8.2, level: 0.95 }, scope: "21 session openers vs 41 later games" },
    ]),
    predictive: { state: "ready", observedGames: 64, window: { label: "48 training · 16 holdout", trainingGames: 48, holdoutGames: 16 }, signals: [{ feature: "champion_experience", direction: "positive", marginalEffect: 0.087 }, { feature: "session_position", direction: "negative", marginalEffect: -0.061 }, { feature: "recent_win_rate", direction: "positive", marginalEffect: 0.044 }] },
    duration: insightSection("duration", "Match length", "Duration bands compared with the selected average", [
      { key: "duration:under_25", title: "Games under 25 minutes", summary: "Shorter games were linked with stronger scores in this selection.", evidenceLevel: "comparative", confidence: "medium", games: 28, eligibleGames: 64, effect: 5.1, unit: "grade", scoreScale: "recall_score_0_100", interval: { low: 1.3, high: 8.9, level: 0.95 }, scope: "28 short games vs 36 longer games" },
    ]),
    trends: insightSection("trends", "Recent form", "Latest 16 games compared with the prior 16", [
      { key: "window:recent", title: "Recent Recall Score", summary: "The latest window is trending upward.", evidenceLevel: "descriptive", confidence: "medium", games: 16, eligibleGames: 32, effect: 4.2, unit: "grade", scoreScale: "recall_score_0_100", interval: { low: 0.9, high: 7.6, level: 0.95 }, scope: "latest 16 vs prior 16" },
    ]),
    champions: insightSection("champions", "Champion patterns", "Champions with repeated graded games compared", [
      { key: "champion:20", title: "Champion 20", summary: "Champion 20 is your clearest established high-score sample.", evidenceLevel: "comparative", confidence: "high", games: 68, eligibleGames: 153, effect: 6.4, unit: "grade", scoreScale: "recall_score_0_100", interval: { low: 2.8, high: 10.0, level: 0.95 }, scope: "68 Nunu games vs 85 other graded games" },
    ]),
    items: insightSection("items", "Final builds", "Repeated final items compared within similar games", [
      { key: "item:2504", title: "Item 2504", summary: "Final builds containing item 2504 appeared in stronger games.", evidenceLevel: "comparative", confidence: "medium", games: 41, eligibleGames: 112, effect: 3.7, unit: "grade", scoreScale: "recall_score_0_100", interval: { low: 0.4, high: 7.0, level: 0.95 }, scope: "41 appearances vs 71 comparable games", caveat: "Final inventory is context, not proof that the item caused the result." },
    ]),
  },
}

const personalRecords = [
  { key: "best_recall_score", label: "Highest Recall Score", category: "Performance", format: "decimal", value: 96.4, gameId: SHOWCASE_GAME_ID - 6, championId: 20, playedAt: SHOWCASE_NOW - 180_000_000, mode: "sr_ranked_solo", source: "match" },
  { key: "most_kills", label: "Most kills", category: "Combat", format: "compact", value: 21, gameId: SHOWCASE_GAME_ID - 12, championId: 103, playedAt: SHOWCASE_NOW - 540_000_000, mode: "sr_ranked_solo", source: "scoreboard" },
  { key: "most_assists", label: "Most assists", category: "Combat", format: "compact", value: 31, gameId: SHOWCASE_GAME_ID - 18, championId: 40, playedAt: SHOWCASE_NOW - 880_000_000, mode: "sr_ranked_solo", source: "scoreboard" },
  { key: "largest_spree", label: "Largest killing spree", category: "Combat", format: "compact", value: 13, gameId: SHOWCASE_GAME_ID - 21, championId: 203, playedAt: SHOWCASE_NOW - 1_040_000_000, mode: "sr_ranked_solo", source: "scoreboard" },
  { key: "most_gold", label: "Most gold earned", category: "Economy", format: "compact", value: 21_840, gameId: SHOWCASE_GAME_ID - 24, championId: 51, playedAt: SHOWCASE_NOW - 1_240_000_000, mode: "sr_ranked_solo", source: "scoreboard" },
  { key: "objective_damage", label: "Most objective damage", category: "Objectives", format: "compact", value: 31_620, gameId: SHOWCASE_GAME_ID, championId: 20, playedAt: SHOWCASE_NOW, mode: "sr_ranked_solo", source: "scoreboard" },
  { key: "vision_score", label: "Highest vision score", category: "Vision", format: "compact", value: 84, gameId: SHOWCASE_GAME_ID - 31, championId: 40, playedAt: SHOWCASE_NOW - 1_800_000_000, mode: "sr_ranked_solo", source: "scoreboard" },
  { key: "fastest_full_clear", label: "Fastest full clear", category: "Timeline", format: "duration", value: 211, gameId: SHOWCASE_GAME_ID - 6, championId: 20, playedAt: SHOWCASE_NOW - 180_000_000, mode: "sr_ranked_solo", source: "timeline" },
  { key: "first_takedown", label: "Fastest first takedown", category: "Timeline", format: "duration", value: 94, gameId: SHOWCASE_GAME_ID - 40, championId: 104, playedAt: SHOWCASE_NOW - 2_200_000_000, mode: "sr_ranked_solo", source: "timeline" },
] as const

const lifetimeTotals = {
  recordedGames: 184, wins: 103, losses: 81, winRate: 103 / 184, timePlayedSecs: 326_416,
  championTakedowns: 2_981, kills: 1_251, deaths: 865, assists: 1_730,
  largestKillingSpree: 13, largestMultiKill: 5, doubleKills: 92, tripleKills: 18,
  quadraKills: 4, pentaKills: 1, surrenders: 22, earlySurrenders: 2, totalCs: 28_460,
  damageToChampions: 4_132_640, damageTaken: 4_633_120, damageSelfMitigated: 3_844_900,
  totalHeal: 1_248_500, totalUnitsHealed: 318, crowdControlSecs: 6_940,
  goldEarned: 2_287_120, visionScore: 5_702, wardsPlaced: 1_894, wardsKilled: 742,
  controlWards: 466, neutralObjectiveDamage: 2_913_400, structureDamage: 640_220,
  turretKills: 146, inhibitorKills: 34, firstBloods: 21,
  detailContext: { measuredGames: 176, neutralMinions: 19_220, goldSpent: 2_204_800, totalDamageDealt: 17_204_000, magicDamageToChampions: 1_906_000, physicalDamageToChampions: 2_018_000, trueDamageToChampions: 208_640, controlWardsPurchased: 481, teammateHealing: 168_200, teammateShielding: 92_400, longestLifeSecs: 1_628 },
  teamContext: { measuredGames: 176, dragons: 302, barons: 87, heralds: 104, voidGrubs: 388, turrets: 1_106, inhibitors: 244 },
}

const showcaseGoals = [
  { id: 1, kind: "rank", targetKey: "RANKED_SOLO_5x5", targetValue: 3_600, label: "Reach Diamond", createdAt: SHOWCASE_NOW - 2_592_000_000, current: 3_374, progress: 0.78 },
  { id: 2, kind: "challenge", targetKey: "101", targetValue: 100, label: "Jungle Diff · Diamond", createdAt: SHOWCASE_NOW - 1_296_000_000, current: 91, progress: 0.91 },
  { id: 3, kind: "rank", targetKey: "RANKED_SOLO_5x5", targetValue: 3_200, label: "Reach Emerald", createdAt: SHOWCASE_NOW - 7_776_000_000, achievedAt: SHOWCASE_NOW - 1_555_200_000, current: 3_374, progress: 1 },
] as const

function summaryFor(filter: Record<string, unknown> | undefined) {
  if (filter?.sinceMs) return { ...summary, games: 4, wins: 3, losses: 1, winRate: 0.75, avgDurationSecs: 1_755 }
  if (filter?.modeFamily === "aram" || filter?.modeFamily === "classic") return { ...emptySummary }
  const championIds = filter?.championIds
  if (Array.isArray(championIds)) {
    const row = championStats.find((entry) => entry.championId === championIds[0])
    return row ? { ...summary, ...row } : { ...emptySummary }
  }
  return { ...summary }
}

function channelValue(channel: string, args: unknown[]) {
  const filter = (args[0] ?? {}) as Record<string, unknown>
  switch (channel) {
    case "window:is-maximized": return false
    case "lcu:status": return { connected: true, summoner: { accountId: "showcase-account", gameName: "RiverQuartz", profileIconId: 29, puuid: OWNER_PUUID, summonerId: 9_100_001, summonerLevel: 412, tagLine: "DEMO" } }
    case "champions:catalog": return champions
    case "settings:ui:get": return { isColoredWhenDone: true, showChampionNames: true, sidebarCollapsed: false }
    case "settings:ui:set": return args[0]
    case "settings:last-seen-patch-notes-version:get": return "3.2.2"
    case "settings:last-seen-patch-notes-version:set": return args[0]
    case "cache:aram-stats:get": return {}
    case "cache:aram-stats:set": return args[0]
    case "cache:ddragon-version:get": return "16.14.1"
    case "cache:ddragon-version:set": return args[0]
    case "app:update-status": return { kind: "up-to-date" }
    case "app:refresh-all": return { fetched: 0, inserted: 0 }
    case "live:get": return currentLiveSession
    case "tempo-overlay:status": return { visible: true, locked: false, shortcutRegistered: true }
    case "tempo-overlay:lock": return { visible: true, locked: true, shortcutRegistered: true }
    case "settings:recommendation-objective:get": return "best_overall"
    case "settings:recommendation-objective:set": return args[0]
    case "recommendations:champions": return []
    case "stats:summary": return summaryFor(filter)
    case "stats:lifetime-totals": return lifetimeTotals
    case "stats:matches": return recentMatches.slice(0, Number(args[1] ?? 20))
    case "matches:list": {
      const rows = filter.bookmarked ? [recentMatches[0]] : recentMatches
      return { rows, total: rows.length, page: Number(args[1] ?? 1), pageSize: Number(args[2] ?? 20) }
    }
    case "matches:champions": return [...new Set(recentMatches.map((row) => row.championId))]
    case "stats:champions": return championStats
    case "stats:champion-performance-snapshot": return { csPerMin: 6.3, visionPerMin: 0.91 }
    case "stats:grades": return [{ grade: "S", count: 5 }, { grade: "A", count: 17 }, { grade: "B", count: 11 }, { grade: "C", count: 4 }]
    case "stats:skill-report": return skillReport
    case "stats:records": return personalRecords
    case "champions:ranked": return { ranked: rankingRows, earlySignals: [], best: rankingRows.slice(0, 3), worst: [...rankingRows].reverse().slice(0, 3) }
    case "profile:summary": return profile
    case "challenges:list": return challenges
    case "challenges:champion-needs": return Object.fromEntries(champions.map((champion, index) => [champion.id, index < 4 ? [{ challengeId: 101 + (index % 3), name: challenges[index % 3].name, currentLevel: challenges[index % 3].currentLevel, currentValue: challenges[index % 3].currentValue, nextThreshold: challenges[index % 3].nextThreshold }] : []]))
    case "ranked:history": return rankedHistory
    case "goals:list": return showcaseGoals
    case "goals:add": return 4
    case "goals:remove": return true
    case "stats:rvi": return args[2] === "match" ? matchPerformance : performanceProfile
    case "review:overview": return { latest: review, recentSession: undefined, bookmarkCount: 1 }
    case "review:match": return review
    case "review:jungle-pathing": return minimapReview
    case "stats:champion-jungle-clears": {
      const championId = Number(args[0])
      const samples = championId === 20 ? clearSamples : []
      return {
        championId,
        jungleGames: samples.length ? 6 : 0,
        telemetryGames: samples.length ? 5 : 0,
        samples,
        averageClearTimeMs: samples.length ? 226_000 : undefined,
        fastest: samples[2],
        longest: samples[3],
      }
    }
    case "augments:owner-summary": return []
    case "augments:cache-catalog": return undefined
    case "review:sessions": return { rows: [], total: 0, page: 1, pageSize: 20 }
    case "tags:list": return [{ id: 1, name: "Clean clear", color: "#5ccfe6" }, { id: 2, name: "Review later", color: "#c8aa6e" }]
    case "timeline:get":
    case "timeline:request": return review.timeline
    case "annotations:save": return { ...review.annotation, ...(args[1] as object) }
    case "riot-api-key:status": return { configured: false, protected: false }
    case "stats:meta": return { databasePath: "showcase-memory-only", totalMatches: summary.games, oldestPlayedAt: SHOWCASE_NOW - 180 * 86_400_000 }
    case "settings:skill-view:get": return undefined
    case "performance-reference:status": return { state: "frozen", requiredMatches: 20, eligibleMatches: 172, largestScopeMatches: 172, scopeMatchCounts: {}, supportedScopes: ["sr"], supportedModes: ["sr_ranked_solo"], modeReferences: [] }
    default: return undefined
  }
}

export function installShowcaseEnvironment(scene = "dashboard") {
  const subscriptions = new Map<string, Set<(...args: unknown[]) => void>>()
  window.showcaseIpcRenderer = {
    on(channel, listener) {
      const listeners = subscriptions.get(channel) ?? new Set()
      listeners.add(listener)
      subscriptions.set(channel, listeners)
    },
    off(channel, listener) {
      subscriptions.get(channel)?.delete(listener)
    },
    send() {
      // Showcase captures never write to Electron or a local Recall database.
    },
    async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      return channelValue(channel, args) as T
    },
  }
  document.documentElement.dataset.showcase = "fictional"
  document.documentElement.dataset.showcaseScene = scene

  if (scene === "tempo") {
    const sequence = [
      { delay: 900, tempo: tempoAnalysis(66, "Stable", "steady") },
      { delay: 2_000, tempo: tempoAnalysis(100, "Double Kill", "up", "gold") },
      { delay: 3_650, tempo: tempoAnalysis(100, "Triple Kill", "up", "emerald") },
      { delay: 5_300, tempo: tempoAnalysis(100, "Quadra Kill", "up", "diamond") },
      { delay: 6_950, tempo: tempoAnalysis(100, "Pentakill", "up", "master") },
      { delay: 9_000, tempo: tempoAnalysis(62, "Stable", "steady") },
      { delay: 10_700, tempo: tempoAnalysis(38, "Slipping", "down") },
    ]
    for (const stage of sequence) {
      window.setTimeout(() => {
        currentLiveSession = liveSessionWithTempo(stage.tempo)
        for (const listener of subscriptions.get("live:updated") ?? []) {
          listener(undefined, currentLiveSession)
        }
      }, stage.delay)
    }
  }
}

export const showcaseGameId = SHOWCASE_GAME_ID
