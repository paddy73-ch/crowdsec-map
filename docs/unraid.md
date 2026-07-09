# Unraid Template

> This template is provided for Unraid users, but it has not yet been verified on a real Unraid installation by the project maintainer.

The Unraid template in `packaging/unraid/crowdsec-map.xml` runs the published Docker image:

```text
ghcr.io/paddy73-ch/crowdsec-map:latest
```

## Install manually

1. Copy `packaging/unraid/crowdsec-map.xml` into the Unraid templates directory.
2. In Unraid, add a new container from the template.
3. Review the environment variables.
4. Start the container.

## Important settings

- `WebUI`: `http://[IP]:[PORT:8088]`
- `Appdata`: `/mnt/user/appdata/crowdsec-map` is mounted to `/app/data` for the History view.
- `HISTORY_FILE`: `/app/data/history.jsonl`
- `HISTORY_RETENTION_DAYS`: `90`
- `PUBLIC_TARGET_IP`: optional manual public IP shown in the dashboard header.
- `PUBLIC_TARGET_IP_AUTO`: auto-detect the public IP when `PUBLIC_TARGET_IP` is empty, default `true`.
- `PUBLIC_TARGET_IP_REFRESH_MINUTES`: public IP auto-detect refresh interval, default `60`.
- `CTI_API_KEY`: optional CrowdSec CTI API key for on-demand IP reputation checks.
- `CTI_CACHE_FILE`: `/app/data/cti-cache.json`
- `CTI_CACHE_HOURS`: `72`
- `ACCESS_LOG_ENABLED`: optional demo visit logging, default `false`.
- `ACCESS_LOG_FILE`: `/app/data/access-log.jsonl`
- `ACCESS_LOG_RETENTION_DAYS`: `30`
- `INVESTIGATION_LOG_PATHS`: optional log paths or globs for the IP Investigation panel.
- `INVESTIGATION_MAX_LINES`: sampled lines per log source, default `12`.
- `INVESTIGATION_TIMEOUT_MS`: maximum scan time, default `8000`.
- Docker socket mount is optional but required when using `cscli` via `CROWDSEC_CONTAINER`.
- LAPI mode avoids Docker socket access and is preferred when you have watcher or bouncer credentials.

For Investigation, mount the relevant host log directories or files read-only and point `INVESTIGATION_LOG_PATHS` to the paths visible inside the container.

## Source modes

- `auto`: try LAPI alerts, LAPI decisions, cscli, then sample data.
- `lapi-alerts`: use watcher credentials.
- `lapi-decisions`: use bouncer API key.
- `cscli`: execute `cscli` in the configured CrowdSec container.
- `sample`: demo data.
