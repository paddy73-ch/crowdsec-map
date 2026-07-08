import geoip from "geoip-lite";
import { config } from "./config.js";

export function normalizeCrowdSecPayload(payload, sourceLabel) {
  const rawItems = Array.isArray(payload) ? payload : payload?.items || payload?.alerts || payload?.decisions || [];
  const alerts = rawItems
    .map((item, index) => normalizeItem(item, index))
    .filter((item) => item && !isFeedUpdate(item.scenario));

  return {
    source: sourceLabel,
    generatedAt: new Date().toISOString(),
    totals: buildTotals(alerts),
    alerts
  };
}

function normalizeItem(item, index) {
  const source = item.source || item;
  const decisions = Array.isArray(item.decisions) ? item.decisions : [];
  const firstDecision = decisions[0] || {};
  const scenario = formatScenarioName(item.scenario || item.scenario_hash || item.scenario_version || item.reason || item.type || "unknown");
  const ip = source.ip || item.ip || item.value || firstDecision.value || item.scope_value || "";
  const geo = resolveGeo(source, ip);
  const target = resolveTarget(item);
  const createdAt = item.created_at || item.start_at || item.until || item.createdAt || item.created || new Date().toISOString();

  if (!geo.latitude || !geo.longitude) {
    return null;
  }

  return {
    id: String(item.id || item.alert_id || firstDecision.id || `${ip}-${createdAt}-${index}`),
    ip,
    country: geo.country || "??",
    city: geo.city || "",
    latitude: Number(geo.latitude),
    longitude: Number(geo.longitude),
    scenario,
    decisionType: firstDecision.type || item.decisionType || item.type || item.decision_type || "alert",
    value: firstDecision.value || item.value || ip,
    targetIp: target.ip,
    targetHost: target.host,
    createdAt,
    count: Number(item.events_count || item.events?.length || item.count || 1),
    asName: source.as_name || source.asName || ""
  };
}

function resolveTarget(item) {
  const eventMeta = firstMetaMap(item.events);
  const alertMeta = metaArrayToObject(item.meta);
  const host = config.targetHost || eventMeta.target_fqdn || eventMeta.target_host || alertMeta.target_fqdn || "";
  const ip = config.targetIp || eventMeta.target_ip || eventMeta.destination_ip || alertMeta.target_ip || "";

  return {
    host: stripJsonArray(host),
    ip: stripJsonArray(ip)
  };
}

function firstMetaMap(events) {
  if (!Array.isArray(events)) {
    return {};
  }

  for (const event of events) {
    const meta = metaArrayToObject(event.meta);
    if (Object.keys(meta).length > 0) {
      return meta;
    }
  }
  return {};
}

function metaArrayToObject(meta) {
  if (!Array.isArray(meta)) {
    return {};
  }

  return Object.fromEntries(meta.map((item) => [item.key, item.value]).filter(([key]) => key));
}

function stripJsonArray(value) {
  if (!value) {
    return "";
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.join(", ");
    }
  } catch {
    // Plain CrowdSec meta values are not JSON encoded.
  }
  return String(value);
}

function resolveGeo(source, ip) {
  const latitude = Number(source.latitude || source.lat);
  const longitude = Number(source.longitude || source.lon || source.lng);

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return {
      latitude,
      longitude,
      country: source.cn || source.country || source.country_code,
      city: source.city
    };
  }

  const lookup = ip ? geoip.lookup(ip) : null;
  if (!lookup) {
    return {};
  }

  return {
    latitude: lookup.ll?.[0],
    longitude: lookup.ll?.[1],
    country: lookup.country,
    city: lookup.city
  };
}

function buildTotals(alerts) {
  return {
    alerts: alerts.length,
    countries: new Set(alerts.map((alert) => alert.country).filter(Boolean)).size,
    scenarios: new Set(alerts.map((alert) => alert.scenario).filter(Boolean)).size,
    bans: alerts.filter((alert) => alert.decisionType === "ban").length
  };
}

export function groupCounts(items, field, limit = 8) {
  const counts = new Map();
  for (const item of items) {
    const key = item[field] || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function formatScenarioName(value) {
  return String(value).replace(/^crowdsecurity\//, "");
}

function isFeedUpdate(scenario) {
  return /^update\s*:\s*\+\d+\/-\d+\s+IPs?$/i.test(String(scenario).trim());
}
