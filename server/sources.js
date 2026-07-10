import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { normalizeCrowdSecPayload } from "./normalize.js";
import { sampleAlerts } from "./sampleData.js";

const execFileAsync = promisify(execFile);
let tokenCache = null;
let decisionCache = null;
const lapiHeaders = {
  "User-Agent": "crowdsec-map/v0.2.4"
};
const DECISION_FIELDS = {
  value: (item) => item.ip || item.value,
  ip: (item) => item.ip || item.value,
  scope: (item) => item.scope,
  country: (item) => item.country,
  scenario: (item) => item.scenario,
  origin: (item) => item.origin,
  duration: (item) => item.duration || item.until,
  until: (item) => item.until || item.duration
};

export async function readCrowdSecData(requestedSource = config.dataSource) {
  const source = requestedSource === "auto" ? config.dataSource : requestedSource;
  const candidates = source === "auto" ? ["lapi-alerts", "cscli", "sample"] : [source];
  const errors = [];

  for (const candidate of candidates) {
    try {
      if (candidate === "lapi-alerts") {
        return await readLapiAlerts();
      }
      if (candidate === "cscli") {
        return await readCscliAlerts();
      }
      if (candidate === "sample") {
        return normalizeCrowdSecPayload(sampleAlerts, "sample");
      }
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  const fallback = normalizeCrowdSecPayload(sampleAlerts, "sample");
  fallback.warning = errors.join(" | ") || "No data source returned data";
  return fallback;
}

export async function readActiveBans() {
  const command = config.crowdsecContainer
    ? ["docker", ["exec", config.crowdsecContainer, "cscli", "decisions", "list", "-o", "raw", "--limit", "0"]]
    : ["cscli", ["decisions", "list", "-o", "raw", "--limit", "0"]];

  const { stdout } = await execFileAsync(command[0], command[1], { timeout: 15000, maxBuffer: 1024 * 1024 * 8 });
  return normalizeActiveBansRaw(stdout);
}

export async function readActiveBansForIp(ip) {
  const command = config.crowdsecContainer
    ? ["docker", ["exec", config.crowdsecContainer, "cscli", "decisions", "list", "-o", "json", "--ip", ip, "--limit", "0"]]
    : ["cscli", ["decisions", "list", "-o", "json", "--ip", ip, "--limit", "0"]];

  const { stdout } = await execFileAsync(command[0], command[1], { timeout: 15000, maxBuffer: 1024 * 1024 * 8 });
  return normalizeActiveBans(JSON.parse(stdout));
}

export async function readCscliIpDetails(ip) {
  const command = config.crowdsecContainer
    ? ["docker", ["exec", config.crowdsecContainer, "cscli", "alerts", "list", "-o", "human", "--ip", ip, "--limit", "0"]]
    : ["cscli", ["alerts", "list", "-o", "human", "--ip", ip, "--limit", "0"]];

  const { stdout } = await execFileAsync(command[0], command[1], { timeout: 15000, maxBuffer: 1024 * 1024 * 8 });
  return {
    command: formatCommand(command[0], command[1]),
    output: stdout.trim()
  };
}

async function readCscliAlerts() {
  const command = config.crowdsecContainer
    ? ["docker", ["exec", config.crowdsecContainer, "sh", "-lc", config.cscliCommand]]
    : ["sh", ["-lc", config.cscliCommand]];

  const { stdout } = await execFileAsync(command[0], command[1], { timeout: 60000, maxBuffer: 1024 * 1024 * 64 });
  const payload = JSON.parse(stdout);
  return normalizeCrowdSecPayload(payload, "cscli");
}

async function readLapiAlerts() {
  const token = await getWatcherToken();
  const url = new URL(`${config.lapiUrl}/v1/alerts`);
  url.searchParams.set("limit", String(config.lapiLimit));

  const response = await fetch(url, {
    headers: {
      ...lapiHeaders,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`LAPI alerts failed with HTTP ${response.status}`);
  }

  return normalizeCrowdSecPayload(await response.json(), "lapi-alerts");
}

export async function readLapiDecisionOverview(options = {}) {
  const now = Date.now();
  if (!decisionCache || options.refresh || decisionCache.expiresAt <= now) {
    const data = normalizeCrowdSecPayload(await fetchLapiDecisions(0), "lapi-decisions");
    decisionCache = {
      items: data.alerts,
      cachedAt: new Date().toISOString(),
      expiresAt: now + 60_000
    };
  }

  const query = String(options.search || "").trim();
  const limit = clampNumber(options.limit, 50, 1, 200);
  const offset = clampNumber(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const predicates = buildDecisionPredicates(query);
  const filtered = predicates.length
    ? decisionCache.items.filter((item) => predicates.every((predicate) => predicate(item)))
    : decisionCache.items;
  const sort = Object.hasOwn(DECISION_FIELDS, options.sort) ? options.sort : "";
  const direction = options.direction === "desc" ? "desc" : "asc";
  const sorted = sort ? sortDecisions(filtered, sort, direction) : filtered;
  const items = sorted.slice(offset, offset + limit);

  return {
    generatedAt: new Date().toISOString(),
    cachedAt: decisionCache.cachedAt,
    cacheSeconds: 60,
    total: decisionCache.items.length,
    matched: filtered.length,
    countries: new Set(filtered.map((item) => item.country).filter(Boolean)).size,
    scenarios: new Set(filtered.map((item) => item.scenario).filter(Boolean)).size,
    topCountries: countDecisionFields(filtered, "country"),
    topScenarios: countDecisionFields(filtered, "scenario"),
    topOrigins: countDecisionFields(filtered, "origin"),
    sort,
    direction,
    offset,
    limit,
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
    items
  };
}

export function buildDecisionPredicates(query) {
  if (!query) return [];
  if (query.length > 256) throw decisionQueryError("Search query is limited to 256 characters");

  return query.split(/\s+/).filter(Boolean).map((token) => {
    const fieldMatch = token.match(/^([a-z]+)=(.+)$/i);
    if (fieldMatch) {
      const field = fieldMatch[1].toLowerCase();
      const readField = DECISION_FIELDS[field];
      if (!readField) throw decisionQueryError(`Unknown field '${field}'. Use value, scope, country, scenario, origin, duration or until.`);
      const matcher = buildDecisionMatcher(fieldMatch[2], true);
      return (item) => matcher(readField(item));
    }

    const matcher = buildDecisionMatcher(token);
    return (item) => Object.values(DECISION_FIELDS).some((readField) => matcher(readField(item)));
  });
}

function buildDecisionMatcher(expression, exact = false) {
  if (expression.startsWith("/")) {
    const closingSlash = expression.lastIndexOf("/");
    if (closingSlash <= 0) throw decisionQueryError(`Invalid regex '${expression}': missing closing slash`);
    const pattern = expression.slice(1, closingSlash);
    const flags = expression.slice(closingSlash + 1);
    if (!/^[imu]*$/.test(flags)) throw decisionQueryError(`Invalid regex flags '${flags}'. Supported flags: i, m, u.`);
    try {
      const regex = new RegExp(pattern, flags);
      return (value) => regex.test(String(value || ""));
    } catch (error) {
      throw decisionQueryError(`Invalid regex '${expression}': ${error.message}`);
    }
  }

  const expected = expression.toLowerCase();
  return (value) => exact
    ? String(value || "").toLowerCase() === expected
    : String(value || "").toLowerCase().includes(expected);
}

export function sortDecisions(items, field, direction) {
  const readField = DECISION_FIELDS[field];
  const factor = direction === "desc" ? -1 : 1;
  return items.map((item, index) => ({ item, index })).sort((left, right) => {
    const leftValue = readField(left.item);
    const rightValue = readField(right.item);
    const compared = field === "duration"
      ? compareDecisionDurations(leftValue, rightValue)
      : String(leftValue || "").localeCompare(String(rightValue || ""), undefined, { numeric: true, sensitivity: "base" });
    return compared ? compared * factor : left.index - right.index;
  }).map(({ item }) => item);
}

function compareDecisionDurations(left, right) {
  const leftSeconds = durationToSeconds(left);
  const rightSeconds = durationToSeconds(right);
  if (leftSeconds !== null && rightSeconds !== null) return leftSeconds - rightSeconds;
  if (leftSeconds !== null) return -1;
  if (rightSeconds !== null) return 1;
  return String(left || "").localeCompare(String(right || ""), undefined, { numeric: true, sensitivity: "base" });
}

function durationToSeconds(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  let seconds = 0;
  let matchedLength = 0;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)([wdhms])/g)) {
    const multiplier = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 }[match[2]];
    seconds += Number(match[1]) * multiplier;
    matchedLength += match[0].length;
  }
  return matchedLength === text.length ? seconds : null;
}

function decisionQueryError(message) {
  const error = new Error(message);
  error.name = "DecisionQueryError";
  return error;
}

async function fetchLapiDecisions(limit) {
  if (!config.lapiApiKey) {
    throw new Error("LAPI_API_KEY is missing");
  }

  const url = new URL(`${config.lapiUrl}/v1/decisions`);
  url.searchParams.set("type", "ban");
  if (limit > 0) {
    url.searchParams.set("limit", String(limit));
  }

  const response = await fetch(url, {
    headers: {
      ...lapiHeaders,
      "X-Api-Key": config.lapiApiKey
    }
  });

  if (!response.ok) {
    throw new Error(`LAPI decisions failed with HTTP ${response.status}`);
  }

  return response.json();
}

function countDecisionFields(items, field, limit = 10) {
  const counts = new Map();
  for (const item of items) {
    const key = item[field] || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function normalizeActiveBans(payload) {
  const rawItems = Array.isArray(payload) ? payload : payload?.items || payload?.decisions || [];
  const bans = [];

  rawItems.forEach((item, index) => {
    const decisions = Array.isArray(item.decisions) ? item.decisions : [item];
    decisions
      .filter((decision) => decision?.type === "ban" && decision.simulated !== true)
      .forEach((decision, decisionIndex) => {
        const ip = decision.value || item.source?.ip || item.value || "";
        if (!ip) {
          return;
        }

        bans.push({
          id: String(decision.id || `${ip}-${index}-${decisionIndex}`),
          ip,
          country: item.source?.cn || item.country || "",
          scenario: String(decision.scenario || item.scenario || item.reason || "ban").replace(/^crowdsecurity\//, ""),
          duration: decision.duration || decision.expiration || "",
          createdAt: decision.created_at || decision.createdAt || decision.start_at || item.created_at || item.createdAt || "",
          until: decision.until || decision.expires_at || decision.expiration || "",
          origin: decision.origin || item.origin || "",
          scope: decision.scope || item.source?.scope || item.scope || "Ip"
        });
      });
  });

  const byIp = new Map();
  bans.forEach((ban) => {
    if (!byIp.has(ban.ip)) {
      byIp.set(ban.ip, ban);
    }
  });

  return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip));
}

function normalizeActiveBansRaw(output) {
  const lines = String(output || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const indexOf = (name) => headers.indexOf(name);
  const indexes = {
    id: indexOf("id"),
    source: indexOf("source"),
    value: indexOf("ip"),
    reason: indexOf("reason"),
    action: indexOf("action"),
    country: indexOf("country"),
    as: indexOf("as"),
    expiration: indexOf("expiration"),
    simulated: indexOf("simulated")
  };

  const bans = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const action = fields[indexes.action] || "";
    const simulated = fields[indexes.simulated] || "";
    if (action !== "ban" || simulated === "true") {
      continue;
    }

    const scopedValue = fields[indexes.value] || "";
    const [scope, value] = scopedValue.includes(":") ? scopedValue.split(/:(.*)/, 2) : ["Ip", scopedValue];
    if (!value) {
      continue;
    }

    bans.push({
      id: fields[indexes.id] || value,
      ip: value,
      country: fields[indexes.country] || "",
      as: fields[indexes.as] || "",
      scenario: String(fields[indexes.reason] || "ban").replace(/^crowdsecurity\//, ""),
      duration: fields[indexes.expiration] || "",
      createdAt: "",
      until: "",
      origin: fields[indexes.source] || "",
      scope: scope || "Ip"
    });
  }

  const byIp = new Map();
  bans.forEach((ban) => {
    if (!byIp.has(ban.ip)) {
      byIp.set(ban.ip, ban);
    }
  });

  return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip));
}

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      fields.push(field);
      field = "";
      continue;
    }
    field += char;
  }
  fields.push(field);
  return fields;
}

function formatCommand(binary, args) {
  return [binary, ...args].map(shellQuote).join(" ");
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}

async function getWatcherToken() {
  if (tokenCache?.expiresAt > Date.now() + 60000) {
    return tokenCache.token;
  }

  if (!config.lapiLogin || !config.lapiPassword) {
    throw new Error("LAPI_LOGIN and LAPI_PASSWORD are missing");
  }

  const response = await fetch(`${config.lapiUrl}/v1/watchers/login`, {
    method: "POST",
    headers: {
      ...lapiHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      machine_id: config.lapiLogin,
      password: config.lapiPassword
    })
  });

  if (!response.ok) {
    throw new Error(`Watcher login failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  const token = data.token || data.jwt;
  if (!token) {
    throw new Error("Watcher login did not return a token");
  }

  tokenCache = {
    token,
    expiresAt: Date.now() + 1000 * 60 * 45
  };
  return token;
}
