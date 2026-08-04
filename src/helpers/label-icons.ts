import { type IconDefinition, faArrowRotateLeft, faArrowTrendDown, faArrowTrendUp, faBan, faBinoculars, faBolt, faBomb, faBriefcaseMedical, faBroom, faBullseye, faCampground, faCartShopping, faChartLine, faChessRook, faCoins, faCrosshairs, faCrown, faDog, faDoorOpen, faDragon, faDroplet, faExplosion, faEye, faEyeSlash, faFeather, faFire, faGaugeHigh, faGavel, faGem, faHammer, faHandFist, faHandHoldingHeart, faHandshakeAngle, faHeartCrack, faHeartPulse, faKitMedical, faLayerGroup, faLeaf, faLightbulb, faLocationCrosshairs, faMap, faMapLocationDot, faMapPin, faMedal, faMeteor, faPeopleGroup, faPersonRunning, faPiggyBank, faRoad, faRocket, faSackDollar, faScaleUnbalanced, faSeedling, faShield, faShieldHalved, faShoePrints, faSkull, faSkullCrossbones, faSnowflake, faStar, faStopwatch, faTag, faTowerObservation, faTree, faTrophy, faUserGroup, faUserNinja, faUserSecret, faUserSlash, faWandMagicSparkles, faWheatAwn } from "@fortawesome/free-solid-svg-icons"

export interface LabelIcon {
  id: string
  name: string
  icon: IconDefinition
}

/** One icon per label awarded by the match-summary and timeline evaluators. */
export const LABEL_ICONS: LabelIcon[] = [
  { id: "mvp", name: "MVP", icon: faMedal },
  { id: "pentakill", name: "Pentakill", icon: faSkullCrossbones },
  { id: "quadra_kill", name: "Quadra Threat", icon: faExplosion },
  { id: "triple_kill", name: "Threefold", icon: faBolt },
  { id: "rampage", name: "Double-Digit Menace", icon: faMeteor },
  { id: "killing_spree", name: "Unbroken Momentum", icon: faFire },
  { id: "assist_machine", name: "Assist Machine", icon: faUserGroup },
  { id: "first_blood", name: "First Blood", icon: faDroplet },
  { id: "deathless", name: "Deathless", icon: faShieldHalved },
  { id: "hard_to_kill", name: "Hard to Kill", icon: faHeartPulse },
  { id: "frequent_flyer", name: "Gray Screen Regular", icon: faSkull },
  { id: "top_damage", name: "Damage Crown", icon: faCrown },
  { id: "heavy_hitter", name: "Heavy Hitter", icon: faHandFist },
  { id: "untouchable_artillery", name: "Untouchable Artillery", icon: faRocket },
  { id: "glass_cannon", name: "Glass Cannon", icon: faBomb },
  { id: "damage_efficiency", name: "Punching Up", icon: faScaleUnbalanced },
  { id: "damage_sponge", name: "Damage Sponge", icon: faShield },
  { id: "low_damage", name: "Wet Noodle", icon: faFeather },
  { id: "true_damage", name: "True Damage Menace", icon: faWandMagicSparkles },
  { id: "farm_machine", name: "Farm Machine", icon: faWheatAwn },
  { id: "low_economy_hero", name: "Low-Economy Hero", icon: faPiggyBank },
  { id: "low_return", name: "All Bark, No Bite", icon: faDog },
  { id: "visionary", name: "Visionary", icon: faEye },
  { id: "sweeper", name: "Sweeper", icon: faBroom },
  { id: "control_freak", name: "Control Freak", icon: faLightbulb },
  { id: "no_control_wards", name: "No Pink Budget", icon: faEyeSlash },
  { id: "objective_force", name: "Objective Force", icon: faBullseye },
  { id: "demolition_crew", name: "Demolition Crew", icon: faHammer },
  { id: "tower_taker", name: "Tower Taker", icon: faChessRook },
  { id: "no_structure_damage", name: "No Structure Damage", icon: faBan },
  { id: "plate_collector", name: "Plate Collector", icon: faLayerGroup },
  { id: "objective_thief", name: "Objective Thief", icon: faUserSecret },
  { id: "first_tower", name: "First Tower", icon: faTowerObservation },
  { id: "team_player", name: "Always There", icon: faPeopleGroup },
  { id: "low_participation", name: "Out of the Action", icon: faUserSlash },
  { id: "crowd_controller", name: "Crowd Controller", icon: faSnowflake },
  { id: "healing_leader", name: "Field Medic", icon: faKitMedical },
  { id: "ally_healer", name: "Team Medic", icon: faBriefcaseMedical },
  { id: "shield_wall", name: "Shield Wall", icon: faHandHoldingHeart },
  { id: "solo_advantage", name: "Solo Advantage", icon: faUserNinja },
  { id: "first_blood_assist", name: "First Blood Assist", icon: faHandshakeAngle },
  { id: "invader", name: "Invader", icon: faDoorOpen },
  { id: "early_predator", name: "Early Predator", icon: faStopwatch },
  { id: "shutdown_collector", name: "Shutdown Collector", icon: faCoins },
  { id: "bounty_hunter", name: "Bounty Hunter", icon: faSackDollar },
  { id: "merciless", name: "Merciless", icon: faGavel },
  { id: "marked_target", name: "Marked Target", icon: faCrosshairs },
  { id: "late_bloomer", name: "Late Bloomer", icon: faSeedling },
  { id: "gank_machine", name: "Gank Machine", icon: faPersonRunning },
  { id: "every_lane_wins", name: "Every Lane Wins", icon: faMapLocationDot },
  { id: "camping_permit", name: "Camping Permit", icon: faCampground },
  { id: "roam_reward", name: "Roam Reward", icon: faMap },
  { id: "early_lead", name: "Early Lead", icon: faArrowTrendUp },
  { id: "comeback_lane", name: "Comeback Lane", icon: faArrowRotateLeft },
  { id: "lead_lost", name: "Lead Lost", icon: faArrowTrendDown },
  { id: "xp_gap", name: "XP Gap", icon: faChartLine },
  { id: "counter_jungler", name: "Counter Jungler", icon: faLeaf },
  { id: "jungle_invaded", name: "Jungle Invaded", icon: faTree },
  { id: "deep_vision", name: "Deep Vision", icon: faBinoculars },
  { id: "objective_master", name: "Objective Master", icon: faStar },
  { id: "dragon_slayer", name: "Dragon Slayer", icon: faDragon },
  { id: "objective_presence", name: "Objective Presence", icon: faLocationCrosshairs },
  { id: "first_tower_pressure", name: "First Tower Pressure", icon: faGaugeHigh },
  { id: "inhibitor_breaker", name: "Inhibitor Breaker", icon: faGem },
  { id: "splitpush_threat", name: "Splitpush Threat", icon: faRoad },
  { id: "comeback_king", name: "Comeback King", icon: faTrophy },
  { id: "lead_thrower", name: "Lead Thrower", icon: faHeartCrack },
  { id: "caught_out", name: "Caught Out", icon: faMapPin },
  { id: "overextended", name: "Overextended", icon: faShoePrints },
  { id: "shopping_with_a_fortune", name: "Shopping With a Fortune", icon: faCartShopping },
]

const byKey = new Map<string, IconDefinition>()
for (const entry of LABEL_ICONS) {
  byKey.set(entry.id, entry.icon)
  byKey.set(entry.name.toLowerCase(), entry.icon)
}

/** Resolves a label icon from either its stored id or its display name. */
export const labelIcon = (key: string): IconDefinition =>
  byKey.get(key) ?? byKey.get(key.toLowerCase()) ?? faTag
