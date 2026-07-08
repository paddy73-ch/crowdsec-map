# CrowdSec Map

Kleine Docker-Web-App, die CrowdSec-Alerts oder Decisions aggregiert und auf einer Weltkarte darstellt.

## Schnellstart

```bash
docker compose up -d --build
```

Danach im Browser öffnen:

```text
http://192.168.192.101:8088
```

## Datenquellen

Die App kann mehrere Quellen lesen. Im UI kannst du zwischen `Auto`, `LAPI alerts`, `LAPI decisions`, `cscli` und `Sample` wechseln.

## Bedienung im Dashboard

- `Source` ist direkt in der Toolbar auswählbar.
- `Intervall` ist direkt in der Toolbar auswählbar: `30s`, `1min`, `5min`, `30min`.
- Die Intervall-Auswahl, die Ranking-Umschalter und die Anzahl der Timeline-Zeilen bleiben nach einem Seiten-Refresh im Browser erhalten.
- Links oben zeigt `Active Bans` die aktuell aktiven CrowdSec-Ban-Decisions.
- Die Ranking-Panels können zwischen `Countries`, `IPs`, `Scenarios` und `Bans` umgeschaltet werden.
- `Bans` listet die aktiv gebannten IPs mit ihrer Restlaufzeit.
- Die Timeline gruppiert Alerts nach Quell-IP und Minute. Bei mehr Einträgen kann die Timeline auf bis zu drei Zeilen erweitert werden.

### Variante A: `cscli` per bestehendem CrowdSec-Container

Das ist die einfachste Variante, wenn dein CrowdSec-Container bereits `cscli alerts list -o json` kann. In `docker-compose.yml` muss der Containername passen:

```yaml
environment:
  DATA_SOURCE: "cscli"
  CROWDSEC_CONTAINER: "crowdsec"
  CSCLI_COMMAND: "cscli alerts list -o json --limit 250"
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

Prüfen:

```bash
docker exec crowdsec cscli alerts list -o json --limit 5
```

### Variante B: LAPI Alerts

Alerts sind für die Karte ideal, weil CrowdSec darin häufig `source.latitude`, `source.longitude`, `source.cn` und `source.as_name` liefert.

1. In CrowdSec eine Machine für die Map registrieren.
2. Machine in CrowdSec validieren.
3. `LAPI_URL`, `LAPI_LOGIN` und `LAPI_PASSWORD` setzen.

Beispiel:

```yaml
environment:
  DATA_SOURCE: "lapi-alerts"
  LAPI_URL: "http://crowdsec:8080"
  LAPI_LOGIN: "crowdsec-map"
  LAPI_PASSWORD: "dein-passwort"
```

### Variante C: LAPI Decisions

Diese Variante nutzt einen Bouncer-Key gegen `/v1/decisions`. Sie ist gut für aktuelle Bans, enthält aber je nach CrowdSec-Daten weniger Kontext als Alerts.

```yaml
environment:
  DATA_SOURCE: "lapi-decisions"
  LAPI_URL: "http://crowdsec:8080"
  LAPI_API_KEY: "dein-bouncer-key"
```

## Wichtige Umgebungsvariablen

| Variable | Zweck |
| --- | --- |
| `PORT` | Web/API-Port im Container, Standard `8088` |
| `DATA_SOURCE` | `auto`, `cscli`, `lapi-alerts`, `lapi-decisions`, `sample` |
| `REFRESH_SECONDS` | Auto-Refresh-Intervall |
| `CROWDSEC_CONTAINER` | Docker-Containername für `docker exec ... cscli` |
| `CSCLI_COMMAND` | Auszuführender `cscli`-Befehl |
| `LAPI_URL` | CrowdSec LAPI URL |
| `LAPI_LOGIN` / `LAPI_PASSWORD` | Watcher/Machine-Credentials für Alerts |
| `LAPI_API_KEY` | Bouncer-Key für Decisions |

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

Backend: `http://localhost:8088/api/attacks`

## Hinweise

- Wenn CrowdSec keine Koordinaten mitliefert, versucht die App eine GeoIP-Auflösung über `geoip-lite`.
- Wenn `DATA_SOURCE=auto` keine echte Quelle erreicht, zeigt die App Sample-Daten und eine Warnung in der Timeline.
- Für `cscli` aus einem separaten Container braucht die App Zugriff auf den Docker-Socket. Wenn du das vermeiden willst, nutze LAPI.
