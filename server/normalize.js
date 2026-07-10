import geoip from "geoip-lite";

export function normalizeCrowdSecPayload(payload, sourceLabel) {
  const rawItems = Array.isArray(payload) ? payload : payload?.items || payload?.alerts || payload?.decisions || [];
  const alerts = rawItems
    .map((item, index) => normalizeItem(item, index, sourceLabel))
    .filter((item) => item && !isFeedUpdate(item.scenario));

  return {
    source: sourceLabel,
    generatedAt: new Date().toISOString(),
    totals: buildTotals(alerts),
    alerts
  };
}

function normalizeItem(item, index, sourceLabel) {
  const source = item.source || item;
  const decisions = Array.isArray(item.decisions) ? item.decisions : [];
  const firstDecision = decisions[0] || {};
  const scenario = formatScenarioName(item.scenario || item.scenario_hash || item.scenario_version || item.reason || item.type || "unknown");
  const ip = source.ip || item.ip || item.value || firstDecision.value || item.scope_value || "";
  const geo = resolveGeo(source, ip);
  const createdAt = item.created_at || item.start_at || item.createdAt || item.created || (sourceLabel === "lapi-decisions" ? "" : new Date().toISOString());

  return {
    id: String(item.id || item.alert_id || firstDecision.id || `${ip}-${createdAt}-${index}`),
    ip,
    country: geo.country || source.cn || source.country || source.country_code || "",
    city: geo.city || "",
    latitude: toCoordinate(geo.latitude),
    longitude: toCoordinate(geo.longitude),
    scenario,
    decisionType: firstDecision.type || item.decisionType || item.type || item.decision_type || "alert",
    value: firstDecision.value || item.value || ip,
    createdAt,
    count: Number(item.events_count || item.events?.length || item.count || 1),
    asName: source.as_name || source.asName || "",
    origin: item.origin || firstDecision.origin || "",
    scope: item.scope || firstDecision.scope || source.scope || "Ip",
    duration: item.duration || firstDecision.duration || "",
    until: item.until || item.expires_at || firstDecision.until || firstDecision.expires_at || ""
  };
}

function resolveGeo(source, ip) {
  const latitude = toCoordinate(source.latitude ?? source.lat);
  const longitude = toCoordinate(source.longitude ?? source.lon ?? source.lng);

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

function toCoordinate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
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
