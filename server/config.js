export const config = {
  port: Number(process.env.PORT || 8088),
  dataSource: process.env.DATA_SOURCE || "auto",
  demoMode: parseBoolean(process.env.DEMO_MODE, false),
  demoSnapshotFile: process.env.DEMO_SNAPSHOT_FILE || "data/demo-snapshot.json",
  refreshSeconds: Number(process.env.REFRESH_SECONDS || 30),
  cscliCommand: process.env.CSCLI_COMMAND || "cscli alerts list -o json --limit 0",
  crowdsecContainer: process.env.CROWDSEC_CONTAINER || "",
  lapiUrl: trimTrailingSlash(process.env.LAPI_URL || "http://127.0.0.1:8080"),
  lapiLogin: process.env.LAPI_LOGIN || "",
  lapiPassword: process.env.LAPI_PASSWORD || "",
  lapiApiKey: process.env.LAPI_API_KEY || "",
  lapiCredentialsFile: process.env.LAPI_CREDENTIALS_FILE || "data/lapi-credentials.json",
  lapiAutoSetup: parseBoolean(process.env.LAPI_AUTO_SETUP, false),
  lapiAutoSetupDecisions: parseBoolean(process.env.LAPI_AUTO_SETUP_DECISIONS, false),
  lapiLimit: Number(process.env.LAPI_LIMIT || 0),
  publicTargetIp: process.env.PUBLIC_TARGET_IP || "",
  publicTargetIpAuto: parseBoolean(process.env.PUBLIC_TARGET_IP_AUTO, true),
  publicTargetIpRefreshMinutes: Number(process.env.PUBLIC_TARGET_IP_REFRESH_MINUTES || 60),
  historyFile: process.env.HISTORY_FILE || "data/history.jsonl",
  historyDatabaseFile: process.env.HISTORY_DATABASE_FILE || "data/history.sqlite",
  historyRetentionDays: Number(process.env.HISTORY_RETENTION_DAYS || 90),
  ctiApiKey: process.env.CTI_API_KEY || "",
  ctiApiUrl: trimTrailingSlash(process.env.CTI_API_URL || "https://cti.api.crowdsec.net/v2"),
  ctiCacheFile: process.env.CTI_CACHE_FILE || "data/cti-cache.json",
  ctiCacheHours: Number(process.env.CTI_CACHE_HOURS || 72),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, true),
  accessLogEnabled: parseBoolean(process.env.ACCESS_LOG_ENABLED, false),
  accessLogFile: process.env.ACCESS_LOG_FILE || "data/access-log.jsonl",
  accessLogRetentionDays: Number(process.env.ACCESS_LOG_RETENTION_DAYS || 30),
  investigationLogPaths: parseList(process.env.INVESTIGATION_LOG_PATHS || [
    "/opt/security-stack/zoraxy/config/log/*.log",
    "/opt/security-stack/authelia/config/authelia.log",
    "/var/log/pveproxy/access.log"
  ].join(",")),
  investigationAutoDetect: parseBoolean(process.env.INVESTIGATION_AUTO_DETECT, true),
  investigationMaxLines: Number(process.env.INVESTIGATION_MAX_LINES || 50),
  investigationTimeoutMs: Number(process.env.INVESTIGATION_TIMEOUT_MS || 8000),
  staticDir: process.env.STATIC_DIR || "dist"
};

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseList(value) {
  return String(value || "")
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
