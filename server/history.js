import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { config } from "./config.js";

const MAX_HISTORY_DAYS = 180;
const historyIds = new Set();
let idsLoaded = false;
let compacting = false;

export async function recordHistory(alerts) {
  await ensureHistoryIds();

  const now = new Date();
  const lines = [];

  for (const alert of alerts || []) {
    const entry = normalizeHistoryEntry(alert, now);
    if (!entry || historyIds.has(entry.id)) {
      continue;
    }

    historyIds.add(entry.id);
    lines.push(`${JSON.stringify(entry)}\n`);
  }

  if (lines.length > 0) {
    await ensureHistoryDir();
    await appendFile(config.historyFile, lines.join(""), "utf8");
  }

  void compactHistory().catch((error) => {
    console.warn(`History compaction failed: ${error.message}`);
  });
}

export async function readHistorySummary(options = {}) {
  const days = clampNumber(options.days, 7, 1, MAX_HISTORY_DAYS);
  const groupBy = normalizeGroupBy(options.groupBy);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const groups = new Map();
  let totalEvents = 0;
  let matchedEvents = 0;

  await forEachHistoryEntry((entry) => {
    totalEvents += 1;
    const seenAt = new Date(entry.seenAt).getTime();
    if (!Number.isFinite(seenAt) || seenAt < since) {
      return;
    }

    matchedEvents += 1;
    const key = getHistoryKey(entry, groupBy);
    const count = Number(entry.count || 1);
    const day = entry.seenAt.slice(0, 10);
    const group = groups.get(key) || createHistoryGroup(key);

    group.alerts += count;
    group.events += 1;
    group.daysSeen.add(day);
    group.ips.add(entry.ip || "unknown");
    group.scenarioCounts.set(entry.scenario || "unknown", (group.scenarioCounts.get(entry.scenario || "unknown") || 0) + count);
    group.countryCounts.set(entry.country || "??", (group.countryCounts.get(entry.country || "??") || 0) + count);

    if (!group.firstSeen || seenAt < new Date(group.firstSeen).getTime()) {
      group.firstSeen = entry.seenAt;
    }
    if (!group.lastSeen || seenAt > new Date(group.lastSeen).getTime()) {
      group.lastSeen = entry.seenAt;
    }

    groups.set(key, group);
  });

  const items = [...groups.values()]
    .map((group) => ({
      label: group.label,
      alerts: group.alerts,
      events: group.events,
      daysSeen: group.daysSeen.size,
      ipCount: group.ips.size,
      firstSeen: group.firstSeen,
      lastSeen: group.lastSeen,
      topScenario: topCount(group.scenarioCounts),
      topCountry: topCount(group.countryCounts)
    }))
    .sort((a, b) => {
      if (b.daysSeen !== a.daysSeen) {
        return b.daysSeen - a.daysSeen;
      }
      if (b.alerts !== a.alerts) {
        return b.alerts - a.alerts;
      }
      return new Date(b.lastSeen) - new Date(a.lastSeen);
    })
    .slice(0, 80);

  return {
    generatedAt: new Date().toISOString(),
    days,
    groupBy,
    totalEvents,
    matchedEvents,
    items
  };
}

function normalizeHistoryEntry(alert, now) {
  const ip = String(alert.ip || "").trim();
  const seenAt = new Date(alert.createdAt || now).toISOString();
  const id = String(alert.id || `${ip}-${seenAt}-${alert.scenario || "unknown"}`);

  if (!ip || Number.isNaN(new Date(seenAt).getTime())) {
    return null;
  }

  return {
    id,
    seenAt,
    ip,
    cidr24: toCidr24(ip),
    asName: alert.asName || "",
    country: alert.country || "??",
    scenario: alert.scenario || "unknown",
    count: Number(alert.count || 1)
  };
}

async function ensureHistoryIds() {
  if (idsLoaded) {
    return;
  }

  await forEachHistoryEntry((entry) => {
    if (entry.id) {
      historyIds.add(entry.id);
    }
  });
  idsLoaded = true;
}

async function compactHistory() {
  if (compacting || !idsLoaded || !existsSync(config.historyFile)) {
    return;
  }

  compacting = true;
  try {
    const cutoff = Date.now() - config.historyRetentionDays * 24 * 60 * 60 * 1000;
    const tempFile = `${config.historyFile}.tmp`;
    const keptIds = new Set();
    const lines = [];

    await forEachHistoryEntry((entry) => {
      const seenAt = new Date(entry.seenAt).getTime();
      if (Number.isFinite(seenAt) && seenAt >= cutoff) {
        keptIds.add(entry.id);
        lines.push(`${JSON.stringify(entry)}\n`);
      }
    });

    await ensureHistoryDir();
    await writeFile(tempFile, lines.join(""), "utf8");
    await rename(tempFile, config.historyFile);
    historyIds.clear();
    keptIds.forEach((id) => historyIds.add(id));
  } catch (error) {
    await rm(`${config.historyFile}.tmp`, { force: true }).catch(() => {});
    throw error;
  } finally {
    compacting = false;
  }
}

async function forEachHistoryEntry(callback) {
  if (!existsSync(config.historyFile)) {
    return;
  }

  const stream = createReadStream(config.historyFile, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of reader) {
    if (!line.trim()) {
      continue;
    }
    try {
      callback(JSON.parse(line));
    } catch {
      // Ignore damaged lines and keep the rest of the history usable.
    }
  }
}

async function ensureHistoryDir() {
  await mkdir(path.dirname(config.historyFile), { recursive: true });
}

function createHistoryGroup(label) {
  return {
    label,
    alerts: 0,
    events: 0,
    daysSeen: new Set(),
    ips: new Set(),
    scenarioCounts: new Map(),
    countryCounts: new Map(),
    firstSeen: "",
    lastSeen: ""
  };
}

function getHistoryKey(entry, groupBy) {
  if (groupBy === "ip") {
    return entry.ip || "unknown";
  }
  if (groupBy === "cidr24") {
    return entry.cidr24 || "unknown";
  }
  if (groupBy === "asn") {
    return entry.asName || "unknown";
  }
  if (groupBy === "country") {
    return entry.country || "??";
  }
  return entry.scenario || "unknown";
}

function normalizeGroupBy(value) {
  return ["ip", "cidr24", "asn", "country", "scenario"].includes(value) ? value : "cidr24";
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function toCidr24(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return ip;
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function topCount(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "unknown";
}
