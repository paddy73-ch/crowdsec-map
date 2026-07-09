import fs from "node:fs/promises";
import path from "node:path";
import geoip from "geoip-lite";
import { config } from "./config.js";

const MAX_RECENT_VISITS = 80;
let lastPruneAt = 0;

export async function recordAccessVisit(request, _response, next) {
  if (!config.accessLogEnabled || !shouldLogRequest(request)) {
    next();
    return;
  }

  const ip = getClientIp(request);
  const lookup = geoip.lookup(ip);
  const entry = {
    ts: new Date().toISOString(),
    ip,
    method: request.method,
    path: request.originalUrl || request.url,
    userAgent: request.get("user-agent") || "",
    referer: request.get("referer") || "",
    country: lookup?.country || "",
    xForwardedFor: request.get("x-forwarded-for") || ""
  };

  writeLogEntry(entry).catch((error) => {
    console.warn(`Unable to write access log: ${error.message}`);
  });
  next();
}

export async function readAccessSummary(options = {}) {
  const days = clampNumber(options.days, 1, 1, config.accessLogRetentionDays);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = (await readLogEntries()).filter((entry) => {
    const ts = new Date(entry.ts).getTime();
    return Number.isFinite(ts) && ts >= since;
  });

  const last24hSince = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = entries.filter((entry) => new Date(entry.ts).getTime() >= last24hSince);

  return {
    enabled: config.accessLogEnabled,
    days,
    retentionDays: config.accessLogRetentionDays,
    total: entries.length,
    visits24h: last24h.length,
    uniqueIps: new Set(entries.map((entry) => entry.ip)).size,
    topIps: topCounts(entries, "ip").slice(0, 10),
    topCountries: topCounts(entries, "country").slice(0, 10),
    recent: entries
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, MAX_RECENT_VISITS)
  };
}

function shouldLogRequest(request) {
  if (request.method !== "GET") {
    return false;
  }
  if (request.path.startsWith("/api/")) {
    return false;
  }
  if (path.extname(request.path)) {
    return false;
  }
  const accept = request.get("accept") || "";
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

async function writeLogEntry(entry) {
  await fs.mkdir(path.dirname(config.accessLogFile), { recursive: true });
  await pruneLogIfNeeded();
  await fs.appendFile(config.accessLogFile, `${JSON.stringify(entry)}\n`);
}

async function pruneLogIfNeeded() {
  if (Date.now() - lastPruneAt < 60 * 60 * 1000) {
    return;
  }
  lastPruneAt = Date.now();
  const since = Date.now() - config.accessLogRetentionDays * 24 * 60 * 60 * 1000;
  const entries = (await readLogEntries()).filter((entry) => {
    const ts = new Date(entry.ts).getTime();
    return Number.isFinite(ts) && ts >= since;
  });
  await fs.writeFile(config.accessLogFile, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""));
}

async function readLogEntries() {
  try {
    const content = await fs.readFile(config.accessLogFile, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Unable to read access log: ${error.message}`);
    }
    return [];
  }
}

function topCounts(entries, field) {
  const counts = new Map();
  entries.forEach((entry) => {
    const key = entry[field] || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function getClientIp(request) {
  const ip = request.ip || request.socket?.remoteAddress || "";
  return ip.replace(/^::ffff:/, "");
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}
