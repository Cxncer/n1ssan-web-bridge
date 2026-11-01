import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL =
  "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en";

const SKINS_URL = `${BASE_URL}/skins.json`;
const AGENTS_URL = `${BASE_URL}/agents.json`;
const OUTPUT_PATH = "src/skins.json";

const themes = [
  "pink",
  "orange",
  "white",
  "gold",
  "green",
  "purple",
  "red",
  "blue",
];

const ALLOWED_TYPES = new Set([
  "Pistols",
  "Sniper Rifles",
  "SMGs",
  "Shotguns",
  "Machine Guns",
  "Rifles",
  "Knives",
  "Gloves",
]);

const SHOTGUNS = new Set(["nova", "xm1014", "sawedoff", "mag7"]);

const MACHINE_GUNS = new Set(["negev", "m249"]);

const EXPECTED_WEAPONS = ["Nova", "XM1014", "Negev", "Sawed-Off", "M249"];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function stableNumericId(value) {
  let hash = 2166136261;

  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0 || 1;
}

function getFloatLimit(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0 || number > 1) {
    return null;
  }

  return number;
}

// Returns the CS2 paint-kit index when the source exposes it.
// Agents have no paint kit, so null is expected for them.
function getPaintKit(item) {
  const raw = item?.paint_index;
  if (raw === null || raw === undefined || raw === "") return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function getWeaponName(item) {
  if (typeof item.weapon === "string") {
    return item.weapon;
  }

  return item.weapon?.name ?? "";
}

function getFinishName(item) {
  if (item.pattern?.name) {
    return item.pattern.name;
  }

  const fullName = item.name ?? "";
  const separator = fullName.indexOf("|");

  if (separator !== -1) {
    return fullName.slice(separator + 1).trim();
  }

  return fullName;
}

function getSkinType(item) {
  const category = item.category?.name?.toLowerCase() ?? "";
  const weapon = getWeaponName(item).trim();
  const normalizedWeapon = normalize(weapon);

  // Classify by weapon name first so unusual API categories
  // cannot accidentally cause these weapons to be discarded.
  if (SHOTGUNS.has(normalizedWeapon) || category.includes("shotgun")) {
    return "Shotguns";
  }

  if (
    MACHINE_GUNS.has(normalizedWeapon) ||
    category.includes("machine gun") ||
    category.includes("machinegun")
  ) {
    return "Machine Guns";
  }

  if (category.includes("glove") || normalizedWeapon.includes("glove")) {
    return "Gloves";
  }

  if (
    category.includes("knife") ||
    normalizedWeapon.includes("knife") ||
    normalizedWeapon.includes("bayonet") ||
    normalizedWeapon === "karambit" ||
    normalizedWeapon === "kukri"
  ) {
    return "Knives";
  }

  if (category.includes("pistol") || category.includes("sidearm")) {
    return "Pistols";
  }

  if (
    category.includes("sniper") ||
    normalizedWeapon.includes("awp") ||
    normalizedWeapon.includes("ssg") ||
    normalizedWeapon.includes("scar20") ||
    normalizedWeapon.includes("g3sg1")
  ) {
    return "Sniper Rifles";
  }

  if (category.includes("smg") || category.includes("submachine")) {
    return "SMGs";
  }

  if (
    category.includes("rifle") ||
    normalizedWeapon === "ak47" ||
    normalizedWeapon === "m4a4" ||
    normalizedWeapon === "m4a1s" ||
    normalizedWeapon === "famas" ||
    normalizedWeapon === "galilar" ||
    normalizedWeapon === "aug" ||
    normalizedWeapon === "sg553"
  ) {
    return "Rifles";
  }

  return "Other";
}

function getAgentTeam(agent) {
  const teamId = agent.team?.id?.toLowerCase() ?? "";
  const teamName = agent.team?.name?.toLowerCase() ?? "";

  if (teamId.includes("counter") || teamName.includes("counter-terrorist")) {
    return "CT Agents";
  }

  if (
    teamId === "terrorists" ||
    teamId === "terrorist" ||
    teamName === "terrorist"
  ) {
    return "T Agents";
  }

  return null;
}

function getArtLabel(weapon) {
  const knownLabels = {
    "AK-47": "AK",
    AWP: "AWP",
    "M4A1-S": "M4",
    M4A4: "M4",
    "Desert Eagle": "DE",
    "USP-S": "USP",
    "Glock-18": "G18",
    "Five-SeveN": "57",
    "SSG 08": "SSG",
    P90: "P90",
    MP9: "MP9",
    "MAC-10": "MAC",
    FAMAS: "FAMAS",
    "Butterfly Knife": "KNF",
    Karambit: "KNF",
    "M9 Bayonet": "KNF",
  };

  return knownLabels[weapon] ?? weapon;
}

async function fetchJson(url, label) {
  console.log(`Downloading ${label}...`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "n1ssan-skin-catalog/2.0",
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`${label} download failed: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`${label} returned invalid or empty data`);
  }

  console.log(`${label}: ${data.length} entries received.`);

  return data;
}

async function main() {
  console.log("Building the n1ssan CS2 catalogue...");
  console.log(`Source: ${BASE_URL}`);
  console.log("");

  // Download both datasets before touching the existing catalogue.
  const [sourceSkins, sourceAgents] = await Promise.all([
    fetchJson(SKINS_URL, "Weapon skins"),
    fetchJson(AGENTS_URL, "Agents"),
  ]);

  const candidates = [];

  const skipped = {
    missingName: 0,
    missingImage: 0,
    unknownAgentTeam: 0,
    duplicates: 0,
    unsupportedCategory: 0,
  };

  for (const item of sourceSkins) {
    const weapon = getWeaponName(item).trim();
    const fullName = (item.name ?? "").trim();
    const image = item.image ?? "";

    if (!weapon || !fullName) {
      skipped.missingName++;
      continue;
    }

    if (typeof image !== "string" || !image.startsWith("https://")) {
      skipped.missingImage++;
      continue;
    }

    const type = getSkinType(item);

    if (!ALLOWED_TYPES.has(type)) {
      skipped.unsupportedCategory++;
      continue;
    }

    const finish = getFinishName(item).trim();

    candidates.push({
      sourceId: String(item.id ?? fullName),
      uniqueKey: `${type}|${weapon}|${finish}`.toLowerCase(),
      weapon,
      name: finish || fullName,
      type,
      rarity:
        typeof item.rarity === "string"
          ? item.rarity
          : (item.rarity?.name ?? "Unknown"),
      image,
      description: typeof item.description === "string" ? item.description : "",
      minFloat: getFloatLimit(item.min_float),
      maxFloat: getFloatLimit(item.max_float),
      paintKit: getPaintKit(item),
      art: getArtLabel(weapon),
    });
  }

  // Agents come from a separate API endpoint.
  for (const agent of sourceAgents) {
    const name = (agent.name ?? "").trim();
    const image = agent.image ?? "";

    if (!name) {
      skipped.missingName++;
      continue;
    }

    if (typeof image !== "string" || !image.startsWith("https://")) {
      skipped.missingImage++;
      continue;
    }

    const type = getAgentTeam(agent);

    if (!type) {
      skipped.unknownAgentTeam++;
      continue;
    }

    candidates.push({
      sourceId: String(agent.id ?? `${type}:${name}`),
      uniqueKey: `${type}|${name}`.toLowerCase(),
      weapon: name,
      name,
      type,
      rarity:
        typeof agent.rarity === "string"
          ? agent.rarity
          : (agent.rarity?.name ?? "Unknown"),
      image,
      description:
        typeof agent.description === "string" ? agent.description : "",
      minFloat: null,
      maxFloat: null,
      // Agents have no paint kit.
      paintKit: null,
      art: type === "T Agents" ? "T" : "CT",
    });
  }

  candidates.sort((a, b) => {
    const typeOrder = a.type.localeCompare(b.type);
    if (typeOrder !== 0) return typeOrder;

    const weaponOrder = a.weapon.localeCompare(b.weapon);
    if (weaponOrder !== 0) return weaponOrder;

    return a.name.localeCompare(b.name);
  });

  const catalog = [];
  const seenKeys = new Set();
  const seenIds = new Set();

  let skinsWithFloatLimits = 0;
  let skinsWithoutFloatLimits = 0;
  let skinsWithPaintKit = 0;
  let skinsWithoutPaintKit = 0;

  for (const item of candidates) {
    if (seenKeys.has(item.uniqueKey)) {
      skipped.duplicates++;
      continue;
    }

    seenKeys.add(item.uniqueKey);

    let id = stableNumericId(item.sourceId);

    // Resolve rare hash collisions deterministically for this build.
    while (seenIds.has(id)) {
      id = id === 2147483647 ? 1 : id + 1;
    }

    seenIds.add(id);

    const isAgent = ["T Agents", "CT Agents"].includes(item.type);

    const hasFloatLimits =
      item.minFloat !== null &&
      item.maxFloat !== null &&
      item.minFloat <= item.maxFloat;

    if (!isAgent && hasFloatLimits) {
      skinsWithFloatLimits++;
    } else if (!isAgent) {
      skinsWithoutFloatLimits++;
    }

    if (!isAgent) {
      if (item.paintKit !== null) {
        skinsWithPaintKit++;
      } else {
        skinsWithoutPaintKit++;
      }
    }

    catalog.push({
      id,
      weapon: item.weapon,
      name: item.name,
      type: item.type,
      rarity: item.rarity,
      color: themes[catalog.length % themes.length],
      art: item.art,
      description: item.description || `${item.name} — ${item.type}.`,
      image: item.image,
      minFloat: item.minFloat,
      maxFloat: item.maxFloat,
      paintKit: item.paintKit,
    });
  }

  if (catalog.length === 0) {
    throw new Error(
      "No usable items were found. Existing skins.json was not overwritten.",
    );
  }

  // Validate the five previously missing weapons before writing.
  const weaponCounts = new Map();

  for (const item of catalog) {
    const key = normalize(item.weapon);
    weaponCounts.set(key, (weaponCounts.get(key) ?? 0) + 1);
  }

  const missingExpectedWeapons = EXPECTED_WEAPONS.filter(
    (weapon) => !weaponCounts.has(normalize(weapon)),
  );

  // Write only after both datasets were downloaded and processed.
  await mkdir("src", { recursive: true });

  await writeFile(OUTPUT_PATH, JSON.stringify(catalog, null, 2), "utf8");

  const counts = new Map();

  for (const item of catalog) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }

  console.log("");
  console.log("================================");
  console.log(" N1SSAN CATALOG GENERATED");
  console.log("================================");
  console.log(`Total catalogue entries: ${catalog.length}`);
  console.log(`Skins with complete float limits: ${skinsWithFloatLimits}`);
  console.log(
    `Skins without complete float limits: ${skinsWithoutFloatLimits}`,
  );
  console.log(`Weapon skins with paintKit: ${skinsWithPaintKit}`);
  console.log(`Weapon skins without paintKit: ${skinsWithoutPaintKit}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log("");
  console.log("Entries by category:");

  for (const [type, count] of [...counts].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("");
  console.log("Expected weapon verification:");

  for (const weapon of EXPECTED_WEAPONS) {
    const count = weaponCounts.get(normalize(weapon)) ?? 0;
    console.log(`  ${weapon}: ${count} skin entries`);
  }

  if (missingExpectedWeapons.length > 0) {
    console.log("");
    console.warn(
      `WARNING: These weapons were not found in the output: ${missingExpectedWeapons.join(", ")}`,
    );
    console.warn(
      "Check the API weapon names and category mapping before assuming the fix is complete.",
    );
  }

  console.log("");
  console.log("Skipped entries:");
  console.log(`  Missing name: ${skipped.missingName}`);
  console.log(`  Missing image: ${skipped.missingImage}`);
  console.log(`  Unknown agent team: ${skipped.unknownAgentTeam}`);
  console.log(`  Unsupported category: ${skipped.unsupportedCategory}`);
  console.log(`  Duplicate entries: ${skipped.duplicates}`);
  console.log("");
  console.log("Catalogue generation complete.");
}

main().catch((error) => {
  console.error("Catalogue generation failed:", error.message);
  process.exitCode = 1;
});
