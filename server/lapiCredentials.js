import { execFile } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);
let storedCredentials = null;
let loadAttempted = false;

export async function getLapiCredentials() {
  if (config.lapiLogin && config.lapiPassword) {
    return { login: config.lapiLogin, password: config.lapiPassword };
  }
  return readStoredCredentials();
}

export async function getLapiApiKey() {
  if (config.lapiApiKey) {
    return config.lapiApiKey;
  }
  return (await readStoredCredentials()).apiKey || "";
}

export async function getLapiCredentialsStatus() {
  const stored = await readStoredCredentials();
  const hasEnvironmentWatcher = Boolean(config.lapiLogin && config.lapiPassword);
  const hasEnvironmentApiKey = Boolean(config.lapiApiKey);
  return {
    file: config.lapiCredentialsFile,
    watcherConfigured: hasEnvironmentWatcher || Boolean(stored.login && stored.password),
    decisionsConfigured: hasEnvironmentApiKey || Boolean(stored.apiKey),
    managed: Boolean(stored.login || stored.password || stored.apiKey),
    autoSetupEnabled: config.lapiAutoSetup
  };
}

export async function autoConfigureLapiCredentials() {
  if (!config.lapiAutoSetup) {
    return { configured: false, reason: "disabled" };
  }
  if (!config.crowdsecContainer) {
    throw new Error("CROWDSEC_CONTAINER is required for LAPI_AUTO_SETUP");
  }

  const existing = await readStoredCredentials();
  const credentials = {
    ...existing,
    login: existing.login || config.lapiLogin,
    password: existing.password || config.lapiPassword,
    apiKey: existing.apiKey || config.lapiApiKey
  };
  if (!credentials.login || !credentials.password) {
    const { stdout, stderr } = await runCscli(["machines", "add", "crowdsec-map", "--auto", "--file", "-"]);
    const machine = parseMachineCredentials(`${stdout}\n${stderr}`);
    if (!machine.login || !machine.password) {
      throw new Error("CrowdSec returned no machine login or password");
    }
    credentials.login = machine.login;
    credentials.password = machine.password;
  }

  if (config.lapiAutoSetupDecisions && !credentials.apiKey) {
    const apiKey = randomBytes(32).toString("hex");
    await runCscli(["bouncers", "add", "crowdsec-map", "--key", apiKey]);
    credentials.apiKey = apiKey;
  }

  await saveStoredCredentials(credentials);
  return { configured: true, alerts: Boolean(credentials.login && credentials.password), decisions: Boolean(credentials.apiKey) };
}

async function readStoredCredentials() {
  if (loadAttempted) {
    return storedCredentials || {};
  }
  loadAttempted = true;
  try {
    const contents = await readFile(config.lapiCredentialsFile, "utf8");
    const parsed = JSON.parse(contents);
    storedCredentials = {
      login: String(parsed.login || ""),
      password: String(parsed.password || ""),
      apiKey: String(parsed.apiKey || "")
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not read LAPI credentials: ${error.message}`);
    }
    storedCredentials = {};
  }
  return storedCredentials;
}

async function saveStoredCredentials(credentials) {
  storedCredentials = credentials;
  loadAttempted = true;
  await writeFile(config.lapiCredentialsFile, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  await chmod(config.lapiCredentialsFile, 0o600);
}

async function runCscli(args) {
  return execFileAsync("docker", ["exec", config.crowdsecContainer, "cscli", ...args], {
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
}

function parseMachineCredentials(output) {
  const login = output.match(/^\s*login:\s*(.+)\s*$/mi)?.[1]?.trim() || "";
  const password = output.match(/^\s*password:\s*(.+)\s*$/mi)?.[1]?.trim() || "";
  return { login, password };
}
