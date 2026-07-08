import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { isIpAddress, readGroupIps, readHistorySummary, readIpHistory, recordHistory } from "./history.js";
import { groupCounts } from "./normalize.js";
import { readActiveBans, readCrowdSecData, readCscliIpDetails } from "./sources.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    source: config.dataSource,
    refreshSeconds: config.refreshSeconds,
    publicTargetIp: config.publicTargetIp
  });
});

app.get("/api/attacks", async (request, response) => {
  const data = await readCrowdSecData(request.query.source || "auto");
  let activeBans = [];
  let activeBansWarning = "";

  try {
    activeBans = await readActiveBans();
  } catch (error) {
    activeBansWarning = `active-bans: ${error.message}`;
  }

  await recordHistory(data.alerts);

  response.json({
    ...data,
    activeBans,
    refreshSeconds: config.refreshSeconds,
    publicTargetIp: config.publicTargetIp,
    warning: [data.warning, activeBansWarning].filter(Boolean).join(" | "),
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
  let cscliWarning = "";

  try {
    cscli = await readCscliIpDetails(request.params.ip);
  } catch (error) {
    cscliWarning = error.message;
  }

  response.json({
    ...history,
    cscli,
    cscliWarning,
    note: "History is filtered by the selected window. CrowdSec raw details depend on CrowdSec alert retention."
  });
});

const staticRoot = path.resolve(__dirname, "..", config.staticDir);
app.use(express.static(staticRoot));
app.get("*", (_request, response) => {
  response.sendFile(path.join(staticRoot, "index.html"));
});

app.listen(config.port, () => {
  console.log(`CrowdSec Map listening on ${config.port}`);
});
