import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { config } from "./config.js";
import { isIpAddress } from "./history.js";

const MAX_INVESTIGATION_DAYS = 180;
const MAX_LINE_LENGTH = 700;

export async function readIpInvestigation(ip, options = {}) {
  if (!isIpAddress(ip)) {
    throw new Error("Invalid IP address");
  }

  const days = clampNumber(options.days, 7, 1, MAX_INVESTIGATION_DAYS);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const deadline = Date.now() + Math.max(1000, config.investigationTimeoutMs);
  const maxLines = clampNumber(config.investigationMaxLines, 12, 0, 100);
  const configuredPaths = config.investigationLogPaths;
  const files = await expandLogFiles(configuredPaths);
  const sources = [];
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
    timedOut,
    sources: sources.sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name)),
    warning: buildWarning(configuredPaths, files, timedOut)
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
      if (/\s403(\s|$)|" 403\s/.test(line)) {
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
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
