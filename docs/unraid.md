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
- `CTI_API_KEY`: optional CrowdSec CTI API key for on-demand IP reputation checks.
- `CTI_CACHE_FILE`: `/app/data/cti-cache.json`
- `CTI_CACHE_HOURS`: `72`
- Docker socket mount is optional but required when using `cscli` via `CROWDSEC_CONTAINER`.
- LAPI mode avoids Docker socket access and is preferred when you have watcher or bouncer credentials.

## Source modes

- `auto`: try LAPI alerts, LAPI decisions, cscli, then sample data.
- `lapi-alerts`: use watcher credentials.
- `lapi-decisions`: use bouncer API key.
- `cscli`: execute `cscli` in the configured CrowdSec container.
- `sample`: demo data.
