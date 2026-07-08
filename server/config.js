export const config = {
  port: Number(process.env.PORT || 8088),
  dataSource: process.env.DATA_SOURCE || "auto",
  refreshSeconds: Number(process.env.REFRESH_SECONDS || 30),
  cscliCommand: process.env.CSCLI_COMMAND || "cscli alerts list -o json --limit 250",
  crowdsecContainer: process.env.CROWDSEC_CONTAINER || "",
  lapiUrl: trimTrailingSlash(process.env.LAPI_URL || "http://127.0.0.1:8080"),
  lapiLogin: process.env.LAPI_LOGIN || "",
  lapiPassword: process.env.LAPI_PASSWORD || "",
  lapiApiKey: process.env.LAPI_API_KEY || "",
  lapiLimit: Number(process.env.LAPI_LIMIT || 250),
  publicTargetIp: process.env.PUBLIC_TARGET_IP || "",
  historyFile: process.env.HISTORY_FILE || "data/history.jsonl",
  historyRetentionDays: Number(process.env.HISTORY_RETENTION_DAYS || 90),
  ctiApiKey: process.env.CTI_API_KEY || "",
  ctiApiUrl: trimTrailingSlash(process.env.CTI_API_URL || "https://cti.api.crowdsec.net/v2"),
  ctiCacheFile: process.env.CTI_CACHE_FILE || "data/cti-cache.json",
  ctiCacheHours: Number(process.env.CTI_CACHE_HOURS || 72),
  staticDir: process.env.STATIC_DIR || "dist"
};

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
