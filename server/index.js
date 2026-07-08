import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { groupCounts } from "./normalize.js";
import { readActiveBans, readCrowdSecData } from "./sources.js";

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

const staticRoot = path.resolve(__dirname, "..", config.staticDir);
app.use(express.static(staticRoot));
app.get("*", (_request, response) => {
  response.sendFile(path.join(staticRoot, "index.html"));
});

app.listen(config.port, () => {
  console.log(`CrowdSec Map listening on ${config.port}`);
});
