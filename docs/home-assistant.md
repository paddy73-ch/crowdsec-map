# Home Assistant Integration

CrowdSec Map can be embedded in Home Assistant while the app keeps running as a normal Docker container.

## Recommended: Webpage dashboard

Recent Home Assistant Core versions no longer load the old `panel_iframe` YAML integration in every installation. On Home Assistant `2026.7.x`, use the UI-based Webpage dashboard or Webpage card instead.

In Home Assistant:

1. Open `Settings`.
2. Open `Dashboards`.
3. Add a dashboard.
4. Choose `Webpage`.
5. Use this URL:

```text
http://192.168.192.101:8088
```

This keeps the CrowdSec Map deployment independent from Home Assistant and avoids changing the running Docker container.

## Notes

- The URL must be reachable from the browser that opens Home Assistant.
- If Home Assistant is served through HTTPS, browsers may block an HTTP iframe as mixed content. In that case, put CrowdSec Map behind the same HTTPS reverse proxy.
- This is not a Home Assistant Add-on. It is the safest integration for Docker, Unraid, and Proxmox because it does not change how CrowdSec Map is deployed.

## Optional Webpage card YAML

If you prefer adding the map inside an existing dashboard, use a Webpage card:

```yaml
type: iframe
url: http://192.168.192.101:8088
aspect_ratio: 100%
```

## Optional reverse proxy URL

If you expose CrowdSec Map through a reverse proxy, point the iframe to that URL:

```text
https://crowdsec-map.example.com
```
