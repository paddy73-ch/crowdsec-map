# CrowdSec Map launch kit

Use this kit to introduce CrowdSec Map consistently across community channels. Adapt the wording to the channel, keep the demo authentic, and link to the GitHub repository:

<https://github.com/paddy73-ch/crowdsec-map>

## Core message

CrowdSec Map is an unofficial, open-source Docker dashboard that turns CrowdSec alerts into a live world map and an investigation workflow. It helps self-hosters see attack origins, identify recurring sources and scenarios, review active bans, and inspect an IP against their own logs.

### What makes it useful

- Live map, activity timeline, and filters for CrowdSec alerts.
- Rankings for countries, IPs, scenarios, and active bans.
- Separate paginated decisions view, so blocklists are not confused with detected attacks.
- On-demand IP investigation against read-only local logs.
- Docker image plus setup paths for Docker, Proxmox/LXC, Unraid, and Home Assistant dashboards.

### Positioning guardrails

- Say **unofficial community project**. It is not affiliated with or endorsed by CrowdSec.
- Say **self-hosted dashboard**, not SIEM or replacement for CrowdSec.
- Do not promise that every alert has accurate geolocation; it depends on the source data and GeoIP fallback.
- Use a screenshot or recording with anonymized/public-safe data only.

## Launch checklist

- [ ] Confirm the public GitHub repository, GHCR image, issue tracker, and `latest` image all work.
- [ ] Record the 60-second walkthrough below using sample or sanitized data.
- [ ] Post first in the CrowdSec community, then adapt it for self-hosting communities.
- [ ] Respond to every early question, especially setup and security questions.
- [ ] Add recurring feedback to GitHub Issues with a short, clear title.
- [ ] After one week, publish a short update: installs/stars if meaningful, most-requested feature, and what is next.

## CrowdSec community post

**Title:** Show CrowdSec alerts on a live map and investigate an IP from one dashboard

Hi everyone — I built **CrowdSec Map**, an unofficial open-source Docker dashboard for visualizing CrowdSec alerts and decisions.

It gives me a quick answer to questions such as: *Where are the current detections coming from? Which scenario is driving activity? Is this IP showing up in my reverse-proxy or authentication logs?*

It includes:

- a live world map and activity timeline based on LAPI alerts;
- filters and rankings for countries, IPs, scenarios, and bans;
- a separate Decisions view, so blocklists do not appear as attacks; and
- an IP Investigation panel that can scan read-only mounted logs for the selected address.

It runs as a Docker container, supports LAPI alerts with a `cscli` fallback, and includes guidance for Proxmox/LXC, Unraid, and Home Assistant dashboards.

GitHub, screenshots, and setup instructions: https://github.com/paddy73-ch/crowdsec-map

It is an independent community project and is not affiliated with or endorsed by CrowdSec. I would especially value feedback on the setup flow and the data you would want to see during incident triage.

## Reddit post for r/selfhosted or r/homelab

**Title:** I made a self-hosted CrowdSec dashboard with a live attack map and IP investigation

I wanted a faster way to make sense of CrowdSec activity than reading a raw alert list, so I made **CrowdSec Map**: a small, open-source Docker app that visualizes CrowdSec alerts on a live map.

Besides the map, it has filters, country/IP/scenario rankings, an activity timeline, active bans, and a separate decisions view. Clicking an address opens an investigation panel that can check that IP in selected, read-only reverse-proxy, authentication, or host logs.

It uses LAPI alerts when available, can fall back to `cscli`, and has deployment notes for Docker, Proxmox/LXC, Unraid, and embedding in Home Assistant.

Repository and setup: https://github.com/paddy73-ch/crowdsec-map

It is an unofficial community project, not a CrowdSec product. I would love practical feedback: what would make this useful in your own security dashboard?

## Short social post

I built CrowdSec Map, an open-source Docker dashboard for turning CrowdSec alerts into a live world map, timeline, active bans, and an IP investigation workflow. LAPI-first, `cscli` fallback, with Unraid and Home Assistant guidance. Feedback welcome: https://github.com/paddy73-ch/crowdsec-map

## 60-second demo script

Record at 1440p or 1080p. Keep the cursor deliberate and avoid showing real IPs, hostnames, credentials, or log content.

| Time | Screen action | Narration |
| --- | --- | --- |
| 0–5s | Open the Live dashboard. | “This is CrowdSec Map: a self-hosted view of the CrowdSec detections happening right now.” |
| 5–15s | Point at summary cards, map, and recent-event table. | “The map shows origins, while the summary and timeline make it easy to see the volume, countries, and active bans.” |
| 15–25s | Filter by a scenario or country. | “Filters update the map, chart, and event list together, so I can isolate one scenario or region quickly.” |
| 25–38s | Open a recent event and then its IP detail. | “When an address looks interesting, I can open it directly from an event instead of copying it between tools.” |
| 38–50s | Show the Investigation area with sanitized/sample results. | “The investigation view can check selected read-only local logs for hits and show matching lines in context.” |
| 50–57s | Switch to Decisions. | “Decisions are intentionally separate from alerts, so a blocklist does not inflate the view of actual detections.” |
| 57–60s | End on the repository URL or project title. | “CrowdSec Map is open source, runs in Docker, and the setup is linked in the repository.” |

## Suggested replies to common questions

**Does it replace CrowdSec?**  
No. CrowdSec Map is a visualization and investigation interface that reads CrowdSec data; CrowdSec remains responsible for detection and remediation.

**Why are decisions separate from alerts?**  
An enforcement decision can come from a large community or third-party blocklist. Treating it as a detected attack would make the dashboard misleading.

**Does it require Docker socket access?**  
Not when using LAPI alerts. Docker socket access is only relevant to the optional `cscli` fallback.

**Does it send my logs elsewhere?**  
The investigation feature scans only the configured local, read-only mounted files. Verify the deployment configuration for your environment before enabling it.
