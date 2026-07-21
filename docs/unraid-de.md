# Unraid-Vorlage

> Diese Vorlage wird für Unraid-Nutzer bereitgestellt, wurde vom Projektbetreuer jedoch noch nicht auf einer echten Unraid-Installation verifiziert.

Die Unraid-Vorlage in `packaging/unraid/crowdsec-map.xml` verwendet das veröffentlichte Docker-Image:

```text
ghcr.io/paddy73-ch/crowdsec-map:latest
```

## Manuell installieren

1. Kopiere `packaging/unraid/crowdsec-map.xml` in das Vorlagenverzeichnis von Unraid.
2. Erstelle in Unraid anhand der Vorlage einen neuen Container.
3. Prüfe die Umgebungsvariablen.
4. Starte den Container.

## Wichtige Einstellungen

- `WebUI`: `http://[IP]:[PORT:8088]`
- `Appdata`: `/mnt/user/appdata/crowdsec-map` wird für die Verlaufsansicht nach `/app/data` eingebunden.
- `HISTORY_FILE`: `/app/data/history.jsonl` (Quelle für eine einmalige Migration)
- `HISTORY_DATABASE_FILE`: `/app/data/history.sqlite`
- `HISTORY_RETENTION_DAYS`: `90`
- `PUBLIC_TARGET_IP`: optionale manuell festgelegte öffentliche IP-Adresse, die in der Kopfzeile des Dashboards angezeigt wird.
- `PUBLIC_TARGET_IP_AUTO`: erkennt die öffentliche IP-Adresse automatisch, wenn `PUBLIC_TARGET_IP` leer ist; Standard: `true`.
- `PUBLIC_TARGET_IP_REFRESH_MINUTES`: Aktualisierungsintervall für die automatische Erkennung der öffentlichen IP-Adresse; Standard: `60`.
- `CTI_API_KEY`: optionaler CrowdSec-CTI-API-Schlüssel für bedarfsgesteuerte IP-Reputationsabfragen.
- `CTI_CACHE_FILE`: `/app/data/cti-cache.json`
- `CTI_CACHE_HOURS`: `72`
- `ACCESS_LOG_ENABLED`: optionales Protokollieren von Demo-Besuchen; Standard: `false`.
- `ACCESS_LOG_FILE`: `/app/data/access-log.jsonl`
- `ACCESS_LOG_RETENTION_DAYS`: `30`
- `INVESTIGATION_LOG_PATHS`: optionale Logpfade oder Platzhalter-Ausdrücke für das Panel zur IP-Untersuchung.
- `INVESTIGATION_AUTO_DETECT`: liest Datei-Akquisitionen automatisch aus dem konfigurierten CrowdSec-Container; Standard: `true`. Erfordert `CROWDSEC_CONTAINER` und die Einbindung des Docker-Sockets.
- `INVESTIGATION_MAX_LINES`: Standardanzahl der pro Logquelle gelesenen Zeilen; Standard: `50`, UI-Limit: `1–200`.
- `INVESTIGATION_TIMEOUT_MS`: maximale Dauer eines Scans; Standard: `8000`.
- Die Einbindung des Docker-Sockets ist optional, aber erforderlich, wenn `cscli` über `CROWDSEC_CONTAINER` verwendet wird.
- Der LAPI-Modus kommt ohne Docker-Socket-Zugriff aus und wird empfohlen, wenn Watcher- oder Bouncer-Zugangsdaten vorhanden sind.

Für die IP-Untersuchung liest CrowdSec Map Datei-Akquisitionen automatisch aus `acquis.yaml` und `acquis.d`, wenn `CROWDSEC_CONTAINER` und der Docker-Socket konfiguriert sind. Die Logdateien werden dabei direkt aus dem CrowdSec-Container gelesen; eine zusätzliche Log-Einbindung ist nicht nötig. Für weitere Logs, die CrowdSec nicht erfasst, können Host-Logverzeichnisse oder -dateien schreibgeschützt eingebunden und die im Container sichtbaren Pfade in `INVESTIGATION_LOG_PATHS` eingetragen werden.

## Quellmodi

- `auto`: versucht nacheinander LAPI-Warnungen, LAPI-Entscheidungen, cscli und anschließend Beispieldaten.
- `lapi-alerts`: verwendet Watcher-Zugangsdaten.
- `lapi-decisions`: verwendet einen Bouncer-API-Schlüssel.
- `cscli`: führt `cscli` im konfigurierten CrowdSec-Container aus.
- `sample`: Beispieldaten für eine Demo.
