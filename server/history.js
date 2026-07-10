import { createReadStream, existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

const MAX_HISTORY_DAYS = 180;
let databasePromise = null;
let lastPrunedAt = 0;

export async function recordHistory(alerts) {
  const database = await getHistoryDatabase();
  const now = new Date();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO alerts
      (id, seen_at, seen_at_ms, ip, cidr24, as_name, country, scenario, event_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  database.exec("BEGIN");
  try {
    for (const alert of alerts || []) {
      const entry = normalizeHistoryEntry(alert, now);
      if (entry) insert.run(...entryValues(entry));
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  if (Date.now() - lastPrunedAt > 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - config.historyRetentionDays * 24 * 60 * 60 * 1000;
    database.prepare("DELETE FROM alerts WHERE seen_at_ms < ?").run(cutoff);
    lastPrunedAt = Date.now();
  }
}

export async function readHistorySummary(options = {}) {
  const days = clampNumber(options.days, 7, 1, MAX_HISTORY_DAYS);
  const groupBy = normalizeGroupBy(options.groupBy);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const groups = new Map();
  const database = await getHistoryDatabase();
  const totalEvents = Number(database.prepare("SELECT COUNT(*) AS count FROM alerts").get().count);
  let matchedEvents = 0;

  await forEachHistoryEntry((entry) => {
    const seenAt = new Date(entry.seenAt).getTime();
    if (!Number.isFinite(seenAt)) {
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
  }, { since });

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

export async function readIpHistory(ip, options = {}) {
  if (!isIpAddress(ip)) {
    throw new Error("Invalid IP address");
  }

  const days = clampNumber(options.days, 7, 1, MAX_HISTORY_DAYS);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const scenarioCounts = new Map();
  const countryCounts = new Map();
  const asNameCounts = new Map();
  const events = [];
  const seenDays = new Set();
  let alerts = 0;
  let firstSeen = "";
  let lastSeen = "";

  await forEachHistoryEntry((entry) => {
    const seenAt = new Date(entry.seenAt).getTime();
    if (!Number.isFinite(seenAt)) {
      return;
    }

    const count = Number(entry.count || 1);
    alerts += count;
    seenDays.add(entry.seenAt.slice(0, 10));
    scenarioCounts.set(entry.scenario || "unknown", (scenarioCounts.get(entry.scenario || "unknown") || 0) + count);
    countryCounts.set(entry.country || "??", (countryCounts.get(entry.country || "??") || 0) + count);
    asNameCounts.set(entry.asName || "unknown", (asNameCounts.get(entry.asName || "unknown") || 0) + count);

    if (!firstSeen || seenAt < new Date(firstSeen).getTime()) {
      firstSeen = entry.seenAt;
    }
    if (!lastSeen || seenAt > new Date(lastSeen).getTime()) {
      lastSeen = entry.seenAt;
    }

    events.push({
      seenAt: entry.seenAt,
      scenario: entry.scenario || "unknown",
      country: entry.country || "??",
      asName: entry.asName || "unknown",
      count
    });
  }, { since, ip });

  events.sort((a, b) => new Date(b.seenAt) - new Date(a.seenAt));

  return {
    ip,
    days,
    generatedAt: new Date().toISOString(),
    alerts,
    events: events.length,
    daysSeen: seenDays.size,
    firstSeen,
    lastSeen,
    topScenario: topCount(scenarioCounts),
    topCountry: topCount(countryCounts),
    topAsName: topCount(asNameCounts),
    scenarios: toCountItems(scenarioCounts),
    countries: toCountItems(countryCounts),
    asNames: toCountItems(asNameCounts),
    recentEvents: events.slice(0, 40)
  };
}

export async function readGroupIps(options = {}) {
  const days = clampNumber(options.days, 7, 1, MAX_HISTORY_DAYS);
  const groupBy = normalizeGroupBy(options.groupBy);
  const label = String(options.label || "").trim();

  if (!label) {
    throw new Error("Group label is missing");
  }

  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const ips = new Map();
  let matchedEvents = 0;

  await forEachHistoryEntry((entry) => {
    const seenAt = new Date(entry.seenAt).getTime();
    if (!Number.isFinite(seenAt)) {
      return;
    }

    matchedEvents += 1;
    const count = Number(entry.count || 1);
    const ip = entry.ip || "unknown";
    const item = ips.get(ip) || createIpGroup(ip);

    item.alerts += count;
    item.events += 1;
    item.daysSeen.add(entry.seenAt.slice(0, 10));
    item.scenarioCounts.set(entry.scenario || "unknown", (item.scenarioCounts.get(entry.scenario || "unknown") || 0) + count);
    item.countryCounts.set(entry.country || "??", (item.countryCounts.get(entry.country || "??") || 0) + count);
    item.asNameCounts.set(entry.asName || "unknown", (item.asNameCounts.get(entry.asName || "unknown") || 0) + count);

    if (!item.lastSeen || seenAt > new Date(item.lastSeen).getTime()) {
      item.lastSeen = entry.seenAt;
    }

    ips.set(ip, item);
  }, { since, groupBy, label });

  const items = [...ips.values()]
    .map((item) => ({
      ip: item.ip,
      alerts: item.alerts,
      events: item.events,
      daysSeen: item.daysSeen.size,
      lastSeen: item.lastSeen,
      topScenario: topCount(item.scenarioCounts),
      topCountry: topCount(item.countryCounts),
      topAsName: topCount(item.asNameCounts)
    }))
    .sort((a, b) => {
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
    label,
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

async function getHistoryDatabase() {
  if (!databasePromise) databasePromise = initializeHistoryDatabase();
  return databasePromise;
}

async function initializeHistoryDatabase() {
  await mkdir(path.dirname(config.historyDatabaseFile), { recursive: true });
  const database = new DatabaseSync(config.historyDatabaseFile);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      seen_at TEXT NOT NULL,
      seen_at_ms INTEGER NOT NULL,
      ip TEXT NOT NULL,
      cidr24 TEXT NOT NULL,
      as_name TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '??',
      scenario TEXT NOT NULL DEFAULT 'unknown',
      event_count INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS alerts_seen_at_idx ON alerts(seen_at_ms DESC);
    CREATE INDEX IF NOT EXISTS alerts_ip_seen_at_idx ON alerts(ip, seen_at_ms DESC);
    CREATE INDEX IF NOT EXISTS alerts_cidr24_seen_at_idx ON alerts(cidr24, seen_at_ms DESC);
    CREATE INDEX IF NOT EXISTS alerts_country_seen_at_idx ON alerts(country, seen_at_ms DESC);
    CREATE INDEX IF NOT EXISTS alerts_scenario_seen_at_idx ON alerts(scenario, seen_at_ms DESC);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  await migrateJsonlHistory(database);
  const cutoff = Date.now() - config.historyRetentionDays * 24 * 60 * 60 * 1000;
  database.prepare("DELETE FROM alerts WHERE seen_at_ms < ?").run(cutoff);
  lastPrunedAt = Date.now();
  return database;
}

async function migrateJsonlHistory(database) {
  const migration = database.prepare("SELECT value FROM metadata WHERE key = 'jsonl_migrated'").get();
  if (migration) return;

  let imported = 0;
  let damaged = 0;
  const insert = database.prepare(`
    INSERT OR IGNORE INTO alerts
      (id, seen_at, seen_at_ms, ip, cidr24, as_name, country, scenario, event_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  database.exec("BEGIN");
  try {
    if (existsSync(config.historyFile)) {
      const stream = createReadStream(config.historyFile, { encoding: "utf8" });
      const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of reader) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const result = insert.run(...entryValues(entry));
          imported += Number(result.changes || 0);
        } catch {
          damaged += 1;
        }
      }
    }
    database.prepare("INSERT INTO metadata (key, value) VALUES ('jsonl_migrated', ?)").run(new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  if (existsSync(config.historyFile)) {
    const backup = `${config.historyFile}.migrated-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await rename(config.historyFile, backup);
    console.log(`History migration completed: ${imported} alerts imported, ${damaged} damaged lines skipped, backup: ${backup}`);
  }
}

async function forEachHistoryEntry(callback, options = {}) {
  const database = await getHistoryDatabase();
  const clauses = [];
  const values = [];
  if (Number.isFinite(options.since)) {
    clauses.push("seen_at_ms >= ?");
    values.push(options.since);
  }
  if (options.ip) {
    clauses.push("ip = ?");
    values.push(options.ip);
  }
  if (options.groupBy && options.label) {
    const column = { ip: "ip", cidr24: "cidr24", asn: "as_name", country: "country", scenario: "scenario" }[options.groupBy];
    clauses.push(`${column} = ?`);
    values.push(options.label);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database.prepare(`SELECT * FROM alerts ${where} ORDER BY seen_at_ms DESC`).all(...values);
  rows.forEach((row) => callback({
    id: row.id,
    seenAt: row.seen_at,
    ip: row.ip,
    cidr24: row.cidr24,
    asName: row.as_name,
    country: row.country,
    scenario: row.scenario,
    count: Number(row.event_count)
  }));
}

function entryValues(entry) {
  if (!entry?.id || !entry?.ip || Number.isNaN(new Date(entry.seenAt).getTime())) {
    throw new Error("Invalid history entry");
  }
  const seenAt = new Date(entry.seenAt).toISOString();
  return [
    String(entry.id),
    seenAt,
    new Date(seenAt).getTime(),
    String(entry.ip),
    entry.cidr24 || toCidr24(String(entry.ip)),
    entry.asName || "",
    entry.country || "??",
    entry.scenario || "unknown",
    Number(entry.count || 1)
  ];
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

function createIpGroup(ip) {
  return {
    ip,
    alerts: 0,
    events: 0,
    daysSeen: new Set(),
    scenarioCounts: new Map(),
    countryCounts: new Map(),
    asNameCounts: new Map(),
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

function toCountItems(counts) {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 12);
}

export function isIpAddress(value) {
  const parts = String(value || "").split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
