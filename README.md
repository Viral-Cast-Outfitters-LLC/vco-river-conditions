# vco-river-conditions

Agent Plugin that wraps the free, no-auth [USGS Water Data OGC API](https://api.waterdata.usgs.gov/docs/ogcapi/) for Viral Cast Outfitters. It returns typed `RiverReading` and `RiverTrend` objects for Colorado fishing gages — not raw USGS JSON.

Site IDs use the modern `USGS-xxxxxxxx` form (8-digit numbers are also accepted as input).

## Tools

| Tool | Purpose |
| --- | --- |
| `get_river_conditions` | Current flow (cfs), water temp (°F), and gage height (ft). `preset` or `sites[]`. |
| `get_river_trend` | Up to 7 days of points for one site and parameter, plus min/max/latest/`change24h`. |
| `find_colorado_gages` | Search Colorado streamgages by name, river, alias (e.g. Deckers), or site ID. |

Missing parameters, seasonal or ice-affected series, and the USGS sentinel `-999999` are returned as `null`. Values are never invented. Water temperature is converted from Celsius to Fahrenheit. Timestamps are ISO 8601 with an America/Denver offset.

## Data source

Primary endpoints (OGC API – Features, documented as v1; v0 exists and currently mirrors the same collections):

- Latest values: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items`
- Time series: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items`
- Site search: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/monitoring-locations/items`

These replace the legacy WaterServices APIs at `waterservices.usgs.gov`, which USGS will decommission on 22 February 2027.

### Attribution

River observations are from the [U.S. Geological Survey (USGS) Water Data APIs](https://api.waterdata.usgs.gov/). Many real-time values are **provisional** and subject to revision. Neither the USGS nor the United States Government may be held liable for damages resulting from their use. See the [USGS provisional data statement](https://waterdata.usgs.gov/provisional-data-statement/).

## Configuration

No API key is required for light use. The plugin is zero-dependency Node (18+, `global fetch`) and ships no secrets.

If you will make more than a few queries per hour, request a free key at [api.data.gov via USGS](https://api.waterdata.usgs.gov/docs/ogcapi/keys/) and set the `USGS_API_KEY` environment variable on the process that launches the MCP server. The server sends it as an `X-Api-Key` header only when that variable is present. Never put a key in the plugin files.

Agent Plugins 1.0.0 `plugin.json` is a closed schema and has no `variables` field, and conformant clients expand only `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` in `mcp.json`. Declaring `variables` would fail schema validation, and putting `"USGS_API_KEY": "${USGS_API_KEY}"` in `mcp.json` `env` would overwrite the real environment with a literal placeholder. Set `USGS_API_KEY` in the host environment instead.

## Run locally

```bash
node server.js
```

`mcp.json` launches that stdio server with `cwd` set to `${PLUGIN_ROOT}`.

## Presets

Every preset site ID was verified live against the USGS Water Data API before inclusion. See `presets.json`. The South Platte “Deckers” gage is **USGS-06701900** (below Brush Creek near Trumbull); no USGS site is named Deckers.

## License

MIT © Viral Cast Outfitters
