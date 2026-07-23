import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPOSITORY = "paddy73-ch/crowdsec-map";
const BRANCH = "dev";
const CACHE_MS = 5 * 60 * 1000;
let cachedStatus = null;
let cacheExpiresAt = 0;

export async function readImageUpdateStatus() {
  if (cacheExpiresAt > Date.now()) {
    return cachedStatus;
  }

  const [runtime, remote] = await Promise.allSettled([readRuntimeRevision(), readRemoteRevision()]);
  const status = buildStatus(runtime, remote);
  cachedStatus = status;
  cacheExpiresAt = Date.now() + CACHE_MS;
  return status;
}

async function readRuntimeRevision() {
  const { stdout } = await execFileAsync("docker", [
    "inspect",
    "--format",
    "{{.Config.Image}}\t{{index .Config.Labels \"org.opencontainers.image.revision\"}}",
    process.env.HOSTNAME || ""
  ], { timeout: 5000, maxBuffer: 64 * 1024 });
  const [image = "", revision = ""] = stdout.trim().split("\t");
  if (!revision) {
    throw new Error("The running image does not expose a Git revision label");
  }
  return { image, revision };
}

async function readRemoteRevision() {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/${BRANCH}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "crowdsec-map"
    },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}`);
  }
  const commit = await response.json();
  if (!commit.sha) {
    throw new Error("GitHub did not return a dev commit");
  }
  return { revision: commit.sha, url: commit.html_url || `https://github.com/${REPOSITORY}/commit/${commit.sha}` };
}

function buildStatus(runtimeResult, remoteResult) {
  const runtime = runtimeResult.status === "fulfilled" ? runtimeResult.value : null;
  const remote = remoteResult.status === "fulfilled" ? remoteResult.value : null;
  const errors = [runtimeResult, remoteResult]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason.message);

  if (!runtime || !remote) {
    return {
      state: "unavailable",
      message: errors.join(" · "),
      image: runtime?.image || "",
      runningRevision: runtime?.revision || "",
      devRevision: remote?.revision || "",
      devUrl: remote?.url || ""
    };
  }

  return {
    state: runtime.revision === remote.revision ? "current" : "update_available",
    image: runtime.image,
    runningRevision: runtime.revision,
    devRevision: remote.revision,
    devUrl: remote.url,
    message: runtime.revision === remote.revision ? "Running image matches the GitHub dev branch." : "A newer dev image is available. Run Force Update in Unraid."
  };
}
