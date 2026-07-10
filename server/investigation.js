import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { config } from "./config.js";
import { isIpAddress } from "./history.js";
import { readActiveBansForIp } from "./sources.js";

const MAX_INVESTIGATION_DAYS = 180;
const MAX_LINE_LENGTH = 700;
const MAX_SAMPLE_LINES = 200;
const MAX_DETAIL_LIMIT = 500;

export async function readIpInvestigation(ip, options = {}) {
  if (!isIpAddress(ip)) {
    throw new Error("Invalid IP address");
  }

  const days = clampNumber(options.days, 7, 1, MAX_INVESTIGATION_DAYS);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const deadline = Date.now() + Math.max(1000, config.investigationTimeoutMs);
  const maxLines = clampNumber(options.maxLines, config.investigationMaxLines, 1, MAX_SAMPLE_LINES);
  const configuredPaths = config.investigationLogPaths;
  const files = await expandLogFiles(configuredPaths);
  const sources = [];
  const activeBanSummary = await readActiveBanSummary(ip);
  let totalHits = 0;
  let totalForbidden = 0;
  let timedOut = false;

  for (const file of files) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }

    const source = await scanLogFile(file, ip, { since, deadline, maxLines });
    sources.push(source);
    totalHits += source.hits;
    totalForbidden += source.forbidden;
    timedOut = timedOut || source.timedOut;
  }

  return {
    ip,
    days,
    generatedAt: new Date().toISOString(),
    configuredPaths,
    availableFiles: files.length,
    scannedFiles: sources.length,
    totalHits,
    totalForbidden,
    activeBans: activeBanSummary,
    maxLines,
    maxSampleLines: MAX_SAMPLE_LINES,
    timedOut,
    sources: sources.sort(compareInvestigationSources),
    warning: buildWarning(configuredPaths, files, timedOut)
  };
}

async function readActiveBanSummary(ip) {
  try {
    const bans = (await readActiveBansForIp(ip))
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    return {
      count: bans.length,
      since: bans.find((ban) => ban.createdAt)?.createdAt || "",
      remaining: pickShortestDuration(bans),
      items: bans.map((ban) => ({
        id: ban.id,
        scenario: ban.scenario,
        origin: ban.origin,
        scope: ban.scope,
        value: ban.ip,
        createdAt: ban.createdAt,
        duration: ban.duration,
        until: ban.until
      }))
    };
  } catch (error) {
    return {
      count: 0,
      since: "",
      remaining: "",
      items: [],
      warning: error.message
    };
  }
}

function pickShortestDuration(bans) {
  const durations = bans
    .map((ban) => ({ raw: ban.duration, seconds: parseDurationSeconds(ban.duration) }))
    .filter((duration) => duration.raw);

  const parsed = durations.filter((duration) => Number.isFinite(duration.seconds));
  if (parsed.length > 0) {
    return parsed.sort((a, b) => a.seconds - b.seconds)[0].raw;
  }
  return durations[0]?.raw || "";
}

export async function readInvestigationLogLines(ip, options = {}) {
  if (!isIpAddress(ip)) {
    throw new Error("Invalid IP address");
  }

  const requestedPath = String(options.path || "");
  const days = clampNumber(options.days, 7, 1, MAX_INVESTIGATION_DAYS);
  const offset = clampNumber(options.offset, 0, 0, 1000000);
  const limit = clampNumber(options.limit, 200, 1, MAX_DETAIL_LIMIT);
  const filter = normalizeStatusFilter(options.filter);
  const sort = options.sort === "oldest" ? "oldest" : "newest";
  const search = String(options.search || "").trim().toLowerCase();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const deadline = Date.now() + Math.max(1000, config.investigationTimeoutMs);
  const files = await expandLogFiles(config.investigationLogPaths);
  const file = files.find((candidate) => candidate === requestedPath);

  if (!file) {
    throw new Error("Investigation log source is not configured or readable.");
  }

  const matcher = buildIpMatcher(ip);
  const entries = [];
  let totalHits = 0;
  let totalForbidden = 0;
  let filteredHits = 0;
  let timedOut = false;

  try {
    const stream = createReadStream(file, { encoding: "utf8" });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of reader) {
      if (Date.now() > deadline) {
        timedOut = true;
        stream.destroy();
        break;
      }

      if (!matcher.test(line) || !isInsideWindow(line, since)) {
        continue;
      }

      const forbidden = isForbiddenLine(line);
      totalHits += 1;
      if (forbidden) {
        totalForbidden += 1;
      }

      if (filter === "forbidden" && !forbidden) {
        continue;
      }
      if (filter === "non-forbidden" && forbidden) {
        continue;
      }
      if (search && !line.toLowerCase().includes(search)) {
        continue;
      }

      filteredHits += 1;
      entries.push({
        line: truncateLine(line),
        forbidden,
        timestamp: extractTimestamp(line)
      });
    }
  } catch (error) {
    throw new Error(`Log source could not be read: ${error.message}`);
  }

  entries.sort((a, b) => sort === "oldest" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);

  return {
    ip,
    days,
    source: {
      name: path.basename(file),
      path: file
    },
    generatedAt: new Date().toISOString(),
    offset,
    limit,
    nextOffset: offset + limit < filteredHits ? offset + limit : null,
    totalHits,
    totalForbidden,
    filteredHits,
    filter,
    sort,
    search,
    maxLimit: MAX_DETAIL_LIMIT,
    timedOut,
    lines: entries.slice(offset, offset + limit)
  };
}

async function scanLogFile(file, ip, options) {
  const matcher = buildIpMatcher(ip);
  const source = {
    name: path.basename(file),
    path: file,
    hits: 0,
    forbidden: 0,
    sampledLines: [],
    unreadable: false,
    timedOut: false
  };

  try {
    const stream = createReadStream(file, { encoding: "utf8" });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of reader) {
      if (Date.now() > options.deadline) {
        source.timedOut = true;
        stream.destroy();
        break;
      }

      if (!matcher.test(line) || !isInsideWindow(line, options.since)) {
        continue;
      }

      source.hits += 1;
      if (isForbiddenLine(line)) {
        source.forbidden += 1;
      }

      if (options.maxLines > 0) {
        source.sampledLines.push(truncateLine(line));
        if (source.sampledLines.length > options.maxLines) {
          source.sampledLines.shift();
        }
      }
    }
  } catch (error) {
    source.unreadable = true;
    source.error = error.message;
  }

  return source;
}

async function expandLogFiles(patterns) {
  const files = [];

  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      files.push(...await expandSimpleGlob(pattern));
      continue;
    }

    if (await isReadableFile(pattern)) {
      files.push(pattern);
    }
  }

  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

function compareInvestigationSources(a, b) {
  const aZoraxy = parseZoraxyLogMonth(a.name);
  const bZoraxy = parseZoraxyLogMonth(b.name);

  if (aZoraxy && bZoraxy) {
    return bZoraxy.sortKey - aZoraxy.sortKey || a.name.localeCompare(b.name);
  }
  if (aZoraxy) {
    return -1;
  }
  if (bZoraxy) {
    return 1;
  }
  return b.hits - a.hits || a.name.localeCompare(b.name);
}

function parseZoraxyLogMonth(name) {
  const match = String(name || "").match(/^zr_(\d{4})-(\d{1,2})\.log$/i);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    year,
    month,
    sortKey: year * 100 + month
  };
}

async function expandSimpleGlob(pattern) {
  const directory = path.dirname(pattern);
  const basename = path.basename(pattern);
  const regex = globBasenameToRegex(basename);

  try {
    const entries = await readdir(directory);
    const files = [];
    for (const entry of entries) {
      if (!regex.test(entry)) {
        continue;
      }
      const candidate = path.join(directory, entry);
      if (await isReadableFile(candidate)) {
        files.push(candidate);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function isReadableFile(file) {
  try {
    const fileStat = await stat(file);
    if (!fileStat.isFile()) {
      return false;
    }
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function buildIpMatcher(ip) {
  return new RegExp(`(^|[^0-9.])${escapeRegex(ip)}([^0-9.]|$)`);
}

function isInsideWindow(line, since) {
  const timestamp = extractTimestamp(line);
  return !timestamp || timestamp >= since;
}

function extractTimestamp(line) {
  const match = line.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/);
  if (!match) {
    return 0;
  }
  const normalized = match[0].replace(" ", "T");
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isForbiddenLine(line) {
  return /\s403(\s|$)|" 403\s/.test(line);
}

function parseDurationSeconds(value) {
  const text = String(value || "");
  if (!text) {
    return NaN;
  }

  let seconds = 0;
  const regex = /(\d+)\s*(h|m|s|d)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const amount = Number(match[1]);
    if (match[2] === "d") {
      seconds += amount * 86400;
    } else if (match[2] === "h") {
      seconds += amount * 3600;
    } else if (match[2] === "m") {
      seconds += amount * 60;
    } else {
      seconds += amount;
    }
  }
  return seconds || NaN;
}

function toTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function normalizeStatusFilter(value) {
  return ["all", "forbidden", "non-forbidden"].includes(value) ? value : "all";
}

function globBasenameToRegex(value) {
  return new RegExp(`^${value.split("*").map(escapeRegex).join(".*")}$`);
}

function truncateLine(line) {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line;
}

function buildWarning(configuredPaths, files, timedOut) {
  const warnings = [];
  if (configuredPaths.length === 0) {
    warnings.push("No investigation log paths configured.");
  } else if (files.length === 0) {
    warnings.push("No readable investigation log files found. Mount host logs read-only and set INVESTIGATION_LOG_PATHS.");
  }
  if (timedOut) {
    warnings.push("Investigation stopped early because the scan timeout was reached.");
  }
  return warnings.join(" ");
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    const fallbackNumber = Number(fallback);
    return Number.isFinite(fallbackNumber) ? Math.max(min, Math.min(max, Math.round(fallbackNumber))) : min;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
