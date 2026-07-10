import { config } from "./config.js";

const PROVIDERS = [
  "https://api.ipify.org",
  "https://icanhazip.com",
  "https://ifconfig.me/ip"
];

let cache = {
  ip: "",
  source: "none",
  checkedAt: 0,
  warning: ""
};

export async function readPublicTargetIp() {
  if (config.publicTargetIp) {
    return {
      ip: config.publicTargetIp,
      source: "env",
      warning: ""
    };
  }

  if (!config.publicTargetIpAuto) {
    return {
      ip: "",
      source: "disabled",
      warning: ""
    };
  }

  const maxAgeMs = Math.max(1, config.publicTargetIpRefreshMinutes) * 60 * 1000;
  if (cache.ip && Date.now() - cache.checkedAt < maxAgeMs) {
    return {
      ip: cache.ip,
      source: cache.source,
      warning: cache.warning
    };
  }

  const errors = [];
  for (const provider of PROVIDERS) {
    try {
      const ip = await fetchPublicIp(provider);
      cache = {
        ip,
        source: "auto",
        checkedAt: Date.now(),
        warning: ""
      };
      return {
        ip: cache.ip,
        source: cache.source,
        warning: cache.warning
      };
    } catch (error) {
      errors.push(`${new URL(provider).hostname}: ${error.message}`);
    }
  }

  cache = {
    ip: cache.ip,
    source: cache.ip ? "cached" : "unavailable",
    checkedAt: Date.now(),
    warning: errors.join(" | ")
  };
  return {
    ip: cache.ip,
    source: cache.source,
    warning: cache.warning
  };
}

async function fetchPublicIp(provider) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(provider, {
      headers: { "User-Agent": "crowdsec-map/v0.1.4" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const ip = (await response.text()).trim();
    if (!isPublicIpText(ip)) {
      throw new Error("invalid IP response");
    }
    return ip;
  } finally {
    clearTimeout(timeout);
  }
}

function isPublicIpText(value) {
  return isIpv4(value) || isIpv6(value);
}

function isIpv4(value) {
  const parts = String(value || "").split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpv6(value) {
  return /^[0-9a-f:]+$/i.test(value) && value.includes(":") && value.length <= 45;
}
