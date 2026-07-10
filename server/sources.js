import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { normalizeCrowdSecPayload } from "./normalize.js";
import { sampleAlerts } from "./sampleData.js";

const execFileAsync = promisify(execFile);
let tokenCache = null;
const lapiHeaders = {
  "User-Agent": "crowdsec-map/v0.2.0"
};

export async function readCrowdSecData(requestedSource = config.dataSource) {
  const source = requestedSource === "auto" ? config.dataSource : requestedSource;
  const candidates = source === "auto" ? ["lapi-alerts", "lapi-decisions", "cscli", "sample"] : [source];
  const errors = [];

  for (const candidate of candidates) {
    try {
      if (candidate === "lapi-alerts") {
        return await readLapiAlerts();
      }
      if (candidate === "lapi-decisions") {
        return await readLapiDecisions();
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

async function readLapiDecisions() {
  if (!config.lapiApiKey) {
    throw new Error("LAPI_API_KEY is missing");
  }

  const url = new URL(`${config.lapiUrl}/v1/decisions`);
  url.searchParams.set("type", "ban");

  const response = await fetch(url, {
    headers: {
      ...lapiHeaders,
      "X-Api-Key": config.lapiApiKey
    }
  });

  if (!response.ok) {
    throw new Error(`LAPI decisions failed with HTTP ${response.status}`);
  }

  return normalizeCrowdSecPayload(limitPayload(await response.json(), config.lapiLimit), "lapi-decisions");
}

function limitPayload(payload, limit) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.slice(0, limit);
  }

  if (Array.isArray(payload?.items)) {
    return {
      ...payload,
      items: payload.items.slice(0, limit)
    };
  }

  if (Array.isArray(payload?.decisions)) {
    return {
      ...payload,
      decisions: payload.decisions.slice(0, limit)
    };
  }

  return payload;
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
