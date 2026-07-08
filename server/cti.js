import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const USER_AGENT = "crowdsec-map/v0.1";

export async function readIpReputation(ip, options = {}) {
  const cache = await readCache();

  if (!config.ctiApiKey) {
    return {
      configured: false,
      status: "not_configured",
      summary: "CrowdSec CTI is not configured.",
      cacheHours: config.ctiCacheHours,
      stats: createStats(cache)
    };
  }

  const cached = cache.items?.[ip];
  const maxAgeMs = config.ctiCacheHours * 60 * 60 * 1000;

  if (!options.force && cached?.cachedAt && Date.now() - new Date(cached.cachedAt).getTime() < maxAgeMs) {
    bumpStats(cache, "cacheHits");
    await writeCache(cache);
    return {
      ...cached.data,
      cached: true,
      cachedAt: cached.cachedAt,
      cacheHours: config.ctiCacheHours,
      stats: createStats(cache)
    };
  }

  const data = await fetchIpReputation(ip);
  const cachedAt = new Date().toISOString();
  bumpStats(cache, "networkRequests");
  cache.items = {
    ...(cache.items || {}),
    [ip]: {
      cachedAt,
      data
    }
  };
  await writeCache(cache);

  return {
    ...data,
    cached: false,
    cachedAt,
    cacheHours: config.ctiCacheHours,
    stats: createStats(cache)
  };
}

export async function readReputationStats() {
  const cache = await readCache();
  return {
    configured: Boolean(config.ctiApiKey),
    cacheHours: config.ctiCacheHours,
    ...createStats(cache)
  };
}

async function fetchIpReputation(ip) {
  const response = await fetch(`${config.ctiApiUrl}/smoke/${encodeURIComponent(ip)}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      "x-api-key": config.ctiApiKey
    }
  });

  if (!response.ok) {
    throw new Error(`CrowdSec CTI failed with HTTP ${response.status}`);
  }

  const raw = await response.json();
  return normalizeCtiResponse(ip, raw);
}

function normalizeCtiResponse(ip, raw) {
  const maliciousness = firstNumber([
    raw?.scores?.overall?.aggressiveness,
    raw?.scores?.overall?.maliciousness,
    raw?.scores?.maliciousness,
    raw?.maliciousness,
    raw?.maliciousness_score,
    raw?.reputation?.maliciousness
  ]);
  const backgroundNoise = firstNumber([
    raw?.scores?.overall?.background_noise,
    raw?.scores?.background_noise,
    raw?.background_noise_score,
    raw?.background_noise,
    raw?.reputation?.background_noise
  ]);
  const isFalsePositive = Boolean(raw?.is_false_positive || raw?.false_positive || raw?.reputation?.false_positive);
  const behaviors = uniqStrings([
    ...arrayOfStrings(raw?.behaviors),
    ...arrayOfStrings(raw?.classifications),
    ...arrayOfStrings(raw?.attack_details),
    ...arrayOfStrings(raw?.reputation?.behaviors),
    ...arrayOfStrings(raw?.reputation?.classifications)
  ]);
  const categories = uniqStrings([
    ...arrayOfStrings(raw?.categories),
    ...arrayOfStrings(raw?.reputation?.categories),
    ...arrayOfStrings(raw?.false_positives)
  ]);
  const asName = raw?.as_name || raw?.as?.name || raw?.autonomous_system?.name || raw?.reputation?.as_name || "";
  const country = raw?.country || raw?.location?.country || raw?.reputation?.country || "";
  const firstSeen = raw?.first_seen || raw?.history?.first_seen || "";
  const lastSeen = raw?.last_seen || raw?.history?.last_seen || "";

  return {
    configured: true,
    status: classifyStatus({ maliciousness, behaviors, isFalsePositive }),
    summary: createSummary({ maliciousness, backgroundNoise, behaviors, isFalsePositive }),
    maliciousness,
    backgroundNoise,
    isFalsePositive,
    behaviors: behaviors.slice(0, 8),
    categories: categories.slice(0, 8),
    asName,
    country,
    firstSeen,
    lastSeen,
    webUrl: `https://app.crowdsec.net/cti/${encodeURIComponent(ip)}`,
    shodanUrl: `https://www.shodan.io/host/${encodeURIComponent(ip)}`
  };
}

function classifyStatus({ maliciousness, behaviors, isFalsePositive }) {
  if (isFalsePositive) {
    return "false_positive";
  }
  if (maliciousness >= 0.8 || behaviors.length >= 3) {
    return "malicious";
  }
  if (maliciousness >= 0.35 || behaviors.length > 0) {
    return "suspicious";
  }
  return "unknown";
}

function createSummary({ maliciousness, backgroundNoise, behaviors, isFalsePositive }) {
  if (isFalsePositive) {
    return "Flagged as possible false positive by CrowdSec CTI.";
  }
  if (maliciousness >= 0.8) {
    return "Known aggressive IP in CrowdSec CTI.";
  }
  if (maliciousness >= 0.35 || behaviors.length > 0) {
    return "CrowdSec CTI has suspicious behavior context for this IP.";
  }
  if (Number.isFinite(backgroundNoise) && backgroundNoise > 0) {
    return "CrowdSec CTI reports background-noise activity for this IP.";
  }
  return "No strong malicious reputation signal returned by CrowdSec CTI.";
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(config.ctiCacheFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Unable to read CTI cache: ${error.message}`);
    }
    return { version: 1, items: {} };
  }
}

async function writeCache(cache) {
  await fs.mkdir(path.dirname(config.ctiCacheFile), { recursive: true });
  await fs.writeFile(config.ctiCacheFile, `${JSON.stringify(cache, null, 2)}\n`);
}

function createStats(cache) {
  const period = getStatsPeriod();
  const stats = cache.stats?.period === period ? cache.stats : createEmptyStats(period);
  return {
    cacheHours: config.ctiCacheHours,
    period: stats.period,
    networkRequests: Number(stats.networkRequests || 0),
    cacheHits: Number(stats.cacheHits || 0),
    cachedIps: Object.keys(cache.items || {}).length
  };
}

function bumpStats(cache, field) {
  const period = getStatsPeriod();
  if (cache.stats?.period !== period) {
    cache.stats = createEmptyStats(period);
  }
  cache.stats[field] = Number(cache.stats[field] || 0) + 1;
}

function createEmptyStats(period) {
  return {
    period,
    networkRequests: 0,
    cacheHits: 0
  };
}

function getStatsPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function firstNumber(values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      return item?.label || item?.name || item?.value || item?.scenario || "";
    })
    .filter(Boolean);
}

function uniqStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}
