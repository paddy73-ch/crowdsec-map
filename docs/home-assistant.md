# Home Assistant Integration

CrowdSec Map can be embedded in Home Assistant as a dashboard panel while the app keeps running as a normal Docker container.

## Panel iframe

Add this to `configuration.yaml`:

```yaml
panel_iframe:
  crowdsec_map:
    title: CrowdSec Map
    icon: mdi:shield-alert
    url: "http://192.168.192.101:8088"
```

Restart Home Assistant or reload YAML where supported.

## Notes

- The URL must be reachable from the browser that opens Home Assistant.
- If Home Assistant is served through HTTPS, browsers may block an HTTP iframe as mixed content. In that case, put CrowdSec Map behind the same HTTPS reverse proxy.
- This is not a Home Assistant Add-on. It is the safest integration for Docker, Unraid, and Proxmox because it does not change how CrowdSec Map is deployed.

## Optional reverse proxy path

If you expose CrowdSec Map through a reverse proxy, point the iframe to that URL:

```yaml
panel_iframe:
  crowdsec_map:
    title: CrowdSec Map
    icon: mdi:shield-alert
    url: "https://crowdsec-map.example.com"
```
