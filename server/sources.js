import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { normalizeCrowdSecPayload } from "./normalize.js";
import { sampleAlerts } from "./sampleData.js";

const execFileAsync = promisify(execFile);
let tokenCache = null;
const lapiHeaders = {
  "User-Agent": "crowdsec-map/v0.1"
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

async function readCscliAlerts() {
  const command = config.crowdsecContainer
    ? ["docker", ["exec", config.crowdsecContainer, "sh", "-lc", config.cscliCommand]]
    : ["sh", ["-lc", config.cscliCommand]];

  const { stdout } = await execFileAsync(command[0], command[1], { timeout: 15000, maxBuffer: 1024 * 1024 * 8 });
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
