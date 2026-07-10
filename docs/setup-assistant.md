# Setup assistant

The setup helper prepares CrowdSec Map for an existing Docker-based CrowdSec installation:

```bash
sudo scripts/autosetup-crowdsec-map.sh
```

It creates a CrowdSec machine login for Alerts, a bouncer key for Decisions, and optionally a Compose override containing read-only Investigation log mounts. Secrets are written to `.env`; the file is restricted to mode `600`. Existing credentials are retained unless `--rotate` is explicitly supplied.

## Check an installation

```bash
sudo scripts/autosetup-crowdsec-map.sh --check
```

The command checks environment values and the corresponding CrowdSec registrations without printing secret values.

## Acquisition log detection

The helper automatically detects the running container that provides `cscli`, reads the active LAPI listen port, and builds the internal Docker URL. If detection is ambiguous, it asks for the correct value. `--container` and `--lapi-url` remain available as explicit overrides.

File acquisition detection is enabled by default. It reads paths from the legacy `/etc/crowdsec/acquis.yaml` and the preferred `/etc/crowdsec/acquis.d/*.yaml` files inside the CrowdSec container. Use `--no-detect-logs` to skip it.

Only paths backed by Docker bind mounts can be mapped automatically. Journald, Docker, Loki, Kafka, CloudWatch and network datasources do not expose ordinary files to CrowdSec Map. Unmappable entries are reported and skipped.

Review the generated override before starting the stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.autosetup.yml config
docker compose -f docker-compose.yml -f docker-compose.autosetup.yml up -d --build
```

## CrowdSec CTI API key

The CTI key is different from the local LAPI machine password and bouncer key. It cannot be generated with `cscli`.

1. Sign in to the [CrowdSec Console](https://app.crowdsec.net/).
2. Open **Settings → CTI API Keys**.
3. Select **New Key** and choose the available quota option.
4. Copy the generated key.
5. Store it without putting it in shell history or the process arguments:

   ```bash
   sudo scripts/autosetup-crowdsec-map.sh --cti-key-stdin
   ```

The Community plan currently includes a small free monthly quota, so CrowdSec Map caches successful lookups. See the official [CTI API key guide](https://docs.crowdsec.net/u/console/ip_reputation/api_keys_premium) and [Enrichment API documentation](https://docs.crowdsec.net/u/cti_api/enrichment_api/).

Test a key directly if required:

```bash
read -rsp "CTI API key: " CTI_KEY; echo
curl -fsS -H "x-api-key: $CTI_KEY" \
  https://cti.api.crowdsec.net/v2/smoke/1.1.1.1
unset CTI_KEY
```

## Options

```text
--container NAME       Override automatic CrowdSec container detection
--lapi-url URL         Override the detected internal LAPI URL
--env-file PATH        Environment file to update
--override-file PATH   Generated Compose override
--detect-logs          Discover file acquisitions (default)
--no-detect-logs       Skip Investigation log discovery
--cti-key KEY          Store an existing CTI API key
--cti-key-stdin        Prompt securely for an existing CTI API key
--rotate               Replace existing Map credentials
--check                Diagnose without creating credentials
```
