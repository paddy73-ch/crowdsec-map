#!/usr/bin/env node
/* global process, console */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [inputFile, outputFile, ...args] = process.argv.slice(2);
if (!inputFile || !outputFile) {
  throw new Error("Usage: node scripts/create-demo-snapshot.mjs <alerts.json> <demo-snapshot.json> [--window-hours=36] [--keep-source-ips]");
}

const windowHours = Number(args.find((arg) => arg.startsWith("--window-hours="))?.split("=")[1] || 36);
const keepSourceIps = args.includes("--keep-source-ips");
const input = JSON.parse(await readFile(inputFile, "utf8"));
const alerts = Array.isArray(input) ? input : input.items || input.alerts || [];
const now = Date.now();
const snapshot = alerts.map((alert, index) => {
  const source = alert.source || alert;
  const seed = createHash("sha256").update(`${source.ip || alert.ip || index}:${index}`).digest();
  const createdAt = new Date(now - (seed.readUInt32BE(0) % (windowHours * 60 * 60 * 1000))).toISOString();
  return {
    id: `demo-${index + 1}`,
    created_at: createdAt,
    scenario: alert.scenario || alert.scenario_hash || "unknown",
    events_count: Number(alert.events_count || alert.events?.length || alert.count || 1),
    source: {
      ip: keepSourceIps ? (source.ip || alert.ip || "") : `198.18.${seed[4]}.${seed[5]}`,
      cn: source.cn || source.country || source.country_code || "",
      latitude: source.latitude ?? source.lat,
      longitude: source.longitude ?? source.lon ?? source.lng
    }
  };
});

const decisions = snapshot
  .filter((_alert, index) => index % 5 === 0)
  .map((alert, index) => ({
    id: `demo-decision-${index + 1}`,
    ip: alert.source.ip,
    value: alert.source.ip,
    scope: "Ip",
    country: alert.source.cn,
    scenario: alert.scenario,
    origin: "demo-snapshot",
    duration: "4h",
    until: new Date(new Date(alert.created_at).getTime() + 4 * 60 * 60 * 1000).toISOString()
  }));

await writeFile(outputFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), alerts: snapshot, decisions }, null, 2)}\n`);
console.log(`Created ${outputFile} with ${snapshot.length} ${keepSourceIps ? "source-preserving" : "anonymized"} alerts and ${decisions.length} demo decisions.`);
