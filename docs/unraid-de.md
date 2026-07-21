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

## Vorlage automatisch installieren oder aktualisieren

Führe dies im Unraid-Terminal aus, um die aktuelle `dev`-Vorlage in das Verzeichnis der Benutzer-Vorlagen herunterzuladen. Die bisherige Vorlage wird als `crowdsec-map.xml.bak` gesichert.

```bash
curl -fsSL https://raw.githubusercontent.com/paddy73-ch/crowdsec-map/dev/packaging/unraid/install-template.sh -o /tmp/crowdsec-map-template.sh
bash /tmp/crowdsec-map-template.sh dev
```

Für die stabile Vorlage `main` statt `dev` verwenden. Das Aktualisieren der Vorlage ändert keinen bereits erstellten Container; zum Laden eines neuen Docker-Images in Unraid **Force Update** verwenden.

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
- `LAPI_AUTO_SETUP`: auf `true` setzen, um beim nächsten Start die LAPI-Watcher-Zugangsdaten über `cscli` zu erstellen und im Appdata-Verzeichnis zu speichern. Dazu `DATA_SOURCE` auf `lapi-alerts` stellen und eine erreichbare `LAPI_URL` konfigurieren.
- `LAPI_AUTO_SETUP_DECISIONS`: erstellt zusätzlich einen persistenten Bouncer-Key für Entscheidungen; Standard: `false`.
- `LAPI_CREDENTIALS_FILE`: `/app/data/lapi-credentials.json`, Berechtigungen `600`.
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

## Automatische LAPI-Einrichtung

1. CrowdSec Map und CrowdSec in dasselbe eigene Docker-Netzwerk legen, damit CrowdSec Map den Namen des CrowdSec-Containers auflösen kann.
2. `LAPI_URL` auf `http://<Name-des-CrowdSec-Containers>:8080`, `DATA_SOURCE` auf `lapi-alerts` und `LAPI_AUTO_SETUP` auf `true` setzen.
3. Die Vorlage anwenden und CrowdSec Map neu starten. Die App erstellt eine Watcher-Maschine `crowdsec-map` und speichert die Zugangsdaten mit Berechtigung `600` im Appdata-Verzeichnis.
4. Im Container-Log die Meldung `LAPI automatic setup completed` prüfen und danach `LAPI_AUTO_SETUP` wieder auf `false` setzen.

Wenn die Decisions-Ansicht ebenfalls LAPI statt `cscli` verwenden soll, zusätzlich `LAPI_AUTO_SETUP_DECISIONS` auf `true` setzen.

## Quellmodi

- `auto`: versucht nacheinander LAPI-Warnungen, LAPI-Entscheidungen, cscli und anschließend Beispieldaten.
- `lapi-alerts`: verwendet Watcher-Zugangsdaten.
- `lapi-decisions`: verwendet einen Bouncer-API-Schlüssel.
- `cscli`: führt `cscli` im konfigurierten CrowdSec-Container aus.
- `sample`: Beispieldaten für eine Demo.
