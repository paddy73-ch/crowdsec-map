import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { readAccessSummary, recordAccessVisit } from "./accessLog.js";
import { config } from "./config.js";
import { readIpReputation, readReputationStats } from "./cti.js";
import { isIpAddress, readGroupIps, readHistorySummary, readIpHistory, recordHistory } from "./history.js";
import { readInvestigationLogLines, readInvestigationLogSources, readIpInvestigation } from "./investigation.js";
import { autoConfigureLapiCredentials, getLapiCredentialsStatus } from "./lapiCredentials.js";
import { groupCounts } from "./normalize.js";
import { readPublicTargetIp } from "./publicIp.js";
import { readActiveBans, readCrowdSecData, readCscliIpDetails, readDemoDecisionOverview, readLapiDecisionOverview } from "./sources.js";
import { readImageUpdateStatus } from "./updateStatus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", config.trustProxy);

app.get("/api/health", async (_request, response) => {
  const publicTargetIp = await readPublicTargetIp();
  response.json({
    ok: true,
    source: config.dataSource,
    refreshSeconds: config.refreshSeconds,
    publicTargetIp: publicTargetIp.ip,
    publicTargetIpSource: publicTargetIp.source,
    publicTargetIpWarning: publicTargetIp.warning
  });
});

app.get("/api/attacks", async (request, response) => {
  const data = await readCrowdSecData(request.query.source || "auto");
  const publicTargetIp = await readPublicTargetIp();
  let activeBans = [];
  let activeBansWarning = "";

  if (!config.demoMode) {
    try {
      activeBans = await readActiveBans();
    } catch (error) {
      activeBansWarning = `active-bans: ${error.message}`;
    }
  }

  if (data.source !== "lapi-decisions") {
    await recordHistory(data.alerts);
  }

  response.json({
    ...data,
    activeBans,
    refreshSeconds: config.refreshSeconds,
    publicTargetIp: publicTargetIp.ip,
    publicTargetIpSource: publicTargetIp.source,
    demoMode: config.demoMode,
    warning: [data.warning, activeBansWarning, publicTargetIp.warning && `public-ip: ${publicTargetIp.warning}`].filter(Boolean).join(" | "),
    totals: {
      ...data.totals,
      activeBans: activeBans.length
    },
    topCountries: groupCounts(data.alerts, "country"),
    topScenarios: groupCounts(data.alerts, "scenario")
  });
});

app.get("/api/history", async (request, response) => {
  response.json(await readHistorySummary({
    days: request.query.days,
    groupBy: request.query.groupBy
  }));
});

app.get("/api/decisions", async (request, response) => {
  if (config.demoMode) {
    response.json(await readDemoDecisionOverview({
      search: request.query.search,
      sort: request.query.sort,
      direction: request.query.direction,
      offset: request.query.offset,
      limit: request.query.limit
    }));
    return;
  }
  try {
    response.json(await readLapiDecisionOverview({
      search: request.query.search,
      sort: request.query.sort,
      direction: request.query.direction,
      offset: request.query.offset,
      limit: request.query.limit,
      refresh: request.query.refresh === "1"
    }));
  } catch (error) {
    response.status(error.name === "DecisionQueryError" ? 400 : 500).json({ error: error.message });
  }
});

app.get("/api/history/group", async (request, response) => {
  try {
    response.json(await readGroupIps({
      days: request.query.days,
      groupBy: request.query.groupBy,
      label: request.query.label
    }));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get("/api/history/ip/:ip", async (request, response) => {
  if (!isIpAddress(request.params.ip)) {
    response.status(400).json({ error: "Invalid IP address" });
    return;
  }

  const history = await readIpHistory(request.params.ip, { days: request.query.days });
  let cscli = "";
  let cscliCommand = "";
  let cscliWarning = "";

  try {
    const cscliDetails = await readCscliIpDetails(request.params.ip);
    cscli = cscliDetails.output;
    cscliCommand = cscliDetails.command;
  } catch (error) {
    cscliWarning = error.message;
  }

  response.json({
    ...history,
    cscli,
    cscliCommand,
    cscliWarning,
    note: "CrowdSec alert records, not active bans. History is filtered by the selected window; raw details depend on CrowdSec alert retention."
  });
});

app.get("/api/reputation/stats", async (_request, response) => {
  try {
    response.json(await readReputationStats());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/lapi/credentials/status", async (_request, response) => {
  try {
    response.json(await getLapiCredentialsStatus());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/reputation/ip/:ip", async (request, response) => {
  if (!isIpAddress(request.params.ip)) {
    response.status(400).json({ error: "Invalid IP address" });
    return;
  }

  try {
    response.json(await readIpReputation(request.params.ip, { force: request.query.refresh === "1" }));
  } catch (error) {
    response.status(502).json({ error: error.message });
  }
});

app.get("/api/investigation/ip/:ip", async (request, response) => {
  if (!isIpAddress(request.params.ip)) {
    response.status(400).json({ error: "Invalid IP address" });
    return;
  }

  try {
    response.json(await readIpInvestigation(request.params.ip, {
      days: request.query.days,
      maxLines: request.query.maxLines
    }));
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/investigation/ip/:ip/log-lines", async (request, response) => {
  if (!isIpAddress(request.params.ip)) {
    response.status(400).json({ error: "Invalid IP address" });
    return;
  }

  try {
    response.json(await readInvestigationLogLines(request.params.ip, {
      days: request.query.days,
      path: request.query.path,
      offset: request.query.offset,
      limit: request.query.limit,
      filter: request.query.filter,
      sort: request.query.sort,
      search: request.query.search
    }));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get("/api/investigation/sources", async (_request, response) => {
  try {
    response.json(await readInvestigationLogSources());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/system/update-status", async (_request, response) => {
  try {
    response.json(await readImageUpdateStatus());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

const staticRoot = path.resolve(__dirname, "..", config.staticDir);
app.get("/api/access-log/summary", async (request, response) => {
  response.json(await readAccessSummary({ days: request.query.days }));
});

app.use(recordAccessVisit);
app.use(express.static(staticRoot));
app.get("*", (_request, response) => {
  response.sendFile(path.join(staticRoot, "index.html"));
});

app.listen(config.port, () => {
  console.log(`CrowdSec Map listening on ${config.port}`);
  autoConfigureLapiCredentials()
    .then((result) => result.configured && console.log(`LAPI automatic setup completed (alerts: ${result.alerts}, decisions: ${result.decisions})`))
    .catch((error) => console.error(`LAPI automatic setup failed: ${error.message}`));
});
