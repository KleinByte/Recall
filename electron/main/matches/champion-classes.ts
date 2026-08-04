/**
 * Champion class tags bundled from Riot Data Dragon patch 16.15.1.
 *
 * Used as the offline fallback for champion-class-aware RVI scaling. The
 * live LCU champion catalog overrides these entries whenever it is available,
 * so a new champion is covered as soon as the client reports it.
 * Regenerate with: pnpm sync:champion-classes
 */

export type ChampionClass = "assassin" | "fighter" | "mage" | "marksman" | "support" | "tank"

/** Riot lists the primary class first. */
export const CHAMPION_CLASSES: ReadonlyMap<number, readonly ChampionClass[]> = new Map([
  [1, ["mage", "support"]], // Annie
  [2, ["fighter", "tank"]], // Olaf
  [3, ["tank", "mage"]], // Galio
  [4, ["mage", "marksman"]], // Twisted Fate
  [5, ["fighter", "tank"]], // Xin Zhao
  [6, ["fighter", "tank"]], // Urgot
  [7, ["assassin", "mage"]], // LeBlanc
  [8, ["mage", "fighter"]], // Vladimir
  [9, ["mage", "support"]], // Fiddlesticks
  [10, ["mage", "marksman"]], // Kayle
  [11, ["fighter", "assassin"]], // Master Yi
  [12, ["tank", "support"]], // Alistar
  [13, ["mage"]], // Ryze
  [14, ["tank", "fighter"]], // Sion
  [15, ["marksman"]], // Sivir
  [16, ["support", "mage"]], // Soraka
  [17, ["marksman", "mage"]], // Teemo
  [18, ["marksman", "assassin"]], // Tristana
  [19, ["fighter", "tank"]], // Warwick
  [20, ["tank", "mage"]], // Nunu & Willump
  [21, ["marksman", "mage"]], // Miss Fortune
  [22, ["marksman", "support"]], // Ashe
  [23, ["fighter", "assassin"]], // Tryndamere
  [24, ["fighter"]], // Jax
  [25, ["support", "mage"]], // Morgana
  [26, ["support", "mage"]], // Zilean
  [27, ["tank", "mage"]], // Singed
  [28, ["assassin", "mage"]], // Evelynn
  [29, ["marksman", "assassin"]], // Twitch
  [30, ["mage"]], // Karthus
  [31, ["tank", "mage"]], // Cho'Gath
  [32, ["tank", "support"]], // Amumu
  [33, ["tank"]], // Rammus
  [34, ["mage"]], // Anivia
  [35, ["assassin"]], // Shaco
  [36, ["tank", "fighter"]], // Dr. Mundo
  [37, ["support", "mage"]], // Sona
  [38, ["assassin", "mage"]], // Kassadin
  [39, ["fighter", "assassin"]], // Irelia
  [40, ["support", "mage"]], // Janna
  [41, ["fighter"]], // Gangplank
  [42, ["marksman", "mage"]], // Corki
  [43, ["mage", "support"]], // Karma
  [44, ["support", "tank"]], // Taric
  [45, ["mage"]], // Veigar
  [48, ["fighter", "tank"]], // Trundle
  [50, ["mage", "support"]], // Swain
  [51, ["marksman"]], // Caitlyn
  [53, ["tank", "support"]], // Blitzcrank
  [54, ["tank", "mage"]], // Malphite
  [55, ["assassin", "mage"]], // Katarina
  [56, ["fighter", "assassin"]], // Nocturne
  [57, ["tank", "support"]], // Maokai
  [58, ["fighter", "tank"]], // Renekton
  [59, ["fighter", "tank"]], // Jarvan IV
  [60, ["assassin", "mage"]], // Elise
  [61, ["mage", "support"]], // Orianna
  [62, ["fighter", "tank"]], // Wukong
  [63, ["mage", "support"]], // Brand
  [64, ["fighter", "assassin"]], // Lee Sin
  [67, ["marksman", "assassin"]], // Vayne
  [68, ["fighter", "mage"]], // Rumble
  [69, ["mage"]], // Cassiopeia
  [72, ["tank", "fighter"]], // Skarner
  [74, ["mage", "support"]], // Heimerdinger
  [75, ["fighter", "tank"]], // Nasus
  [76, ["assassin", "mage"]], // Nidalee
  [77, ["fighter", "tank"]], // Udyr
  [78, ["tank", "fighter"]], // Poppy
  [79, ["fighter", "mage"]], // Gragas
  [80, ["fighter", "assassin"]], // Pantheon
  [81, ["marksman", "mage"]], // Ezreal
  [82, ["fighter", "mage"]], // Mordekaiser
  [83, ["fighter", "tank"]], // Yorick
  [84, ["assassin"]], // Akali
  [85, ["mage"]], // Kennen
  [86, ["fighter", "tank"]], // Garen
  [89, ["tank", "support"]], // Leona
  [90, ["mage"]], // Malzahar
  [91, ["assassin"]], // Talon
  [92, ["fighter", "assassin"]], // Riven
  [96, ["marksman", "mage"]], // Kog'Maw
  [98, ["tank"]], // Shen
  [99, ["mage", "support"]], // Lux
  [101, ["mage", "support"]], // Xerath
  [102, ["fighter", "tank"]], // Shyvana
  [103, ["mage", "assassin"]], // Ahri
  [104, ["marksman"]], // Graves
  [105, ["assassin", "fighter"]], // Fizz
  [106, ["fighter", "tank"]], // Volibear
  [107, ["assassin", "fighter"]], // Rengar
  [110, ["marksman", "mage"]], // Varus
  [111, ["tank", "support"]], // Nautilus
  [112, ["mage"]], // Viktor
  [113, ["tank"]], // Sejuani
  [114, ["fighter", "assassin"]], // Fiora
  [115, ["mage"]], // Ziggs
  [117, ["support", "mage"]], // Lulu
  [119, ["marksman"]], // Draven
  [120, ["fighter", "tank"]], // Hecarim
  [121, ["assassin"]], // Kha'Zix
  [122, ["fighter", "tank"]], // Darius
  [126, ["fighter", "marksman"]], // Jayce
  [127, ["mage"]], // Lissandra
  [131, ["fighter", "assassin"]], // Diana
  [133, ["marksman", "assassin"]], // Quinn
  [134, ["mage"]], // Syndra
  [136, ["mage"]], // Aurelion Sol
  [141, ["fighter", "assassin"]], // Kayn
  [142, ["mage"]], // Zoe
  [143, ["mage", "support"]], // Zyra
  [145, ["marksman", "mage"]], // Kai'Sa
  [147, ["support", "mage"]], // Seraphine
  [150, ["fighter", "tank"]], // Gnar
  [154, ["tank", "fighter"]], // Zac
  [157, ["fighter", "assassin"]], // Yasuo
  [161, ["mage", "support"]], // Vel'Koz
  [163, ["mage", "support"]], // Taliyah
  [164, ["fighter", "assassin"]], // Camille
  [166, ["marksman", "assassin"]], // Akshan
  [200, ["fighter"]], // Bel'Veth
  [201, ["tank", "support"]], // Braum
  [202, ["marksman", "mage"]], // Jhin
  [203, ["marksman"]], // Kindred
  [221, ["marksman"]], // Zeri
  [222, ["marksman"]], // Jinx
  [223, ["tank", "support"]], // Tahm Kench
  [233, ["fighter", "assassin"]], // Briar
  [234, ["fighter", "assassin"]], // Viego
  [235, ["support", "marksman"]], // Senna
  [236, ["marksman", "assassin"]], // Lucian
  [238, ["assassin"]], // Zed
  [240, ["fighter"]], // Kled
  [245, ["assassin", "mage"]], // Ekko
  [246, ["assassin"]], // Qiyana
  [254, ["fighter", "assassin"]], // Vi
  [266, ["fighter"]], // Aatrox
  [267, ["support", "mage"]], // Nami
  [268, ["mage", "marksman"]], // Azir
  [350, ["support", "mage"]], // Yuumi
  [360, ["marksman", "assassin"]], // Samira
  [412, ["support", "tank"]], // Thresh
  [420, ["fighter", "tank"]], // Illaoi
  [421, ["fighter", "tank"]], // Rek'Sai
  [427, ["support", "mage"]], // Ivern
  [429, ["marksman"]], // Kalista
  [432, ["support", "mage"]], // Bard
  [497, ["support"]], // Rakan
  [498, ["marksman"]], // Xayah
  [516, ["tank"]], // Ornn
  [517, ["mage", "assassin"]], // Sylas
  [518, ["mage", "support"]], // Neeko
  [523, ["marksman"]], // Aphelios
  [526, ["tank", "support"]], // Rell
  [555, ["support", "assassin"]], // Pyke
  [711, ["mage"]], // Vex
  [777, ["fighter", "assassin"]], // Yone
  [799, ["fighter", "assassin"]], // Ambessa
  [800, ["mage", "support"]], // Mel
  [804, ["marksman"]], // Yunara
  [805, ["assassin", "mage"]], // Locke
  [875, ["fighter", "tank"]], // Sett
  [876, ["fighter", "mage"]], // Lillia
  [887, ["fighter"]], // Gwen
  [888, ["support", "mage"]], // Renata Glasc
  [893, ["mage", "assassin"]], // Aurora
  [895, ["fighter", "assassin"]], // Nilah
  [897, ["tank", "fighter"]], // K'Sante
  [901, ["marksman", "mage"]], // Smolder
  [902, ["support", "mage"]], // Milio
  [904, ["fighter", "assassin"]], // Zaahen
  [910, ["mage", "support"]], // Hwei
  [950, ["assassin", "fighter"]], // Naafiri
  [60001, ["mage", "support"]], // Annie
  [60002, ["fighter", "tank"]], // Olaf
  [60004, ["mage", "marksman"]], // Twisted Fate
  [60009, ["mage", "support"]], // Fiddlesticks
  [60010, ["mage", "marksman"]], // Kayle
  [60011, ["fighter", "assassin"]], // Master Yi
  [60012, ["tank", "support"]], // Alistar
  [60013, ["mage"]], // Ryze
  [60014, ["tank", "fighter"]], // Sion
  [60015, ["marksman"]], // Sivir
  [60016, ["support", "mage"]], // Soraka
  [60017, ["marksman", "mage"]], // Teemo
  [60018, ["marksman", "assassin"]], // Tristana
  [60019, ["fighter", "tank"]], // Warwick
  [60020, ["tank", "mage"]], // Nunu & Willump
  [60021, ["marksman", "mage"]], // Miss Fortune
  [60022, ["marksman", "support"]], // Ashe
  [60023, ["fighter", "assassin"]], // Tryndamere
  [60024, ["fighter"]], // Jax
  [60025, ["support", "mage"]], // Morgana
  [60026, ["support", "mage"]], // Zilean
  [60027, ["tank", "mage"]], // Singed
  [60028, ["assassin", "mage"]], // Evelynn
  [60029, ["marksman", "assassin"]], // Twitch
  [60030, ["mage"]], // Karthus
  [60031, ["tank", "mage"]], // Cho'Gath
  [60032, ["tank", "support"]], // Amumu
  [60033, ["tank"]], // Rammus
  [60034, ["mage", "support"]], // Anivia
  [60035, ["assassin"]], // Shaco
  [60036, ["tank", "fighter"]], // Dr. Mundo
  [60037, ["support", "mage"]], // Sona
  [60038, ["assassin", "mage"]], // Kassadin
  [60040, ["support", "mage"]], // Janna
  [60041, ["fighter"]], // Gangplank
  [60042, ["marksman", "mage"]], // Corki
  [60044, ["support", "tank"]], // Taric
  [60045, ["mage"]], // Veigar
  [60053, ["tank", "support"]], // Blitzcrank
  [60054, ["tank", "mage"]], // Malphite
  [60055, ["assassin", "mage"]], // Katarina
  [60059, ["fighter", "tank"]], // Jarvan IV
  [60062, ["fighter", "tank"]], // Wukong
  [60063, ["mage", "support"]], // Brand
  [60064, ["fighter", "assassin"]], // Lee Sin
  [60067, ["marksman", "assassin"]], // Vayne
  [60072, ["tank", "fighter"]], // Skarner
  [60074, ["mage", "support"]], // Heimerdinger
  [60075, ["fighter", "tank"]], // Nasus
  [60076, ["assassin", "mage"]], // Nidalee
  [60079, ["fighter", "mage"]], // Gragas
  [60080, ["fighter", "assassin"]], // Pantheon
  [60081, ["marksman", "mage"]], // Ezreal
  [60086, ["fighter", "tank"]], // Garen
  [60089, ["tank", "support"]], // Leona
  [60090, ["mage"]], // Malzahar
  [60096, ["marksman", "mage"]], // Kog'Maw
  [60099, ["mage", "support"]], // Lux
  [60103, ["mage", "assassin"]], // Ahri
  [60117, ["support", "mage"]], // Lulu
])
