# vco-river-conditions verification (0.2.0)

Run on the box, 14 Nov 2026, America/Denver (MST, UTC-7). Nothing was submitted to cursor.directory or any marketplace.

## Steps

| Step | Result | Notes |
| --- | --- | --- |
| Confirm modern USGS endpoints | PASS | Docs and live probes use `https://api.waterdata.usgs.gov/ogcapi/v1/`. `/ogcapi/v0/` exists and currently lists the same collections; v1 is the documented path. |
| Re-verify every preset site ID on the new API | PASS | All 12 presets returned live `latest-continuous` features as `USGS-xxxxxxxx`. Same membership as 0.1.0; IDs now use the USGS- prefix. Cheesman and Parkdale are present but seasonal (`value` null, qualifier `SEASONAL`) so readings are null. |
| `plugin.json` vs official schema | PASS | Fetched `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. Valid with Python `jsonschema` Draft 2020-12 and `ajv-cli --spec=draft2020`. |
| `mcp.json` vs official schema | PASS | Fetched `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`. Valid with the same two validators. |
| `node --check server.js` | PASS | Exit 0. |
| Live MCP `initialize` | PASS | NDJSON JSON-RPC. `serverInfo.name=vco-river-conditions`, `version=0.2.0`. |
| Live MCP `tools/list` | PASS | `get_river_conditions`, `get_river_trend`, `find_colorado_gages`. |
| Live MCP `tools/call` get_river_conditions | PASS | `preset=all` returned 12 `RiverReading` objects from the OGC API. Site IDs are `USGS-xxxxxxxx`. Timestamps use America/Denver offsets. Missing/seasonal values are `null`. |
| Live MCP `tools/call` get_river_trend | PASS | Site `USGS-09128000`, `param=flow`, `days=2`: 191 points, min 202, max 205, latest 205 cfs, `change24h=0`. |
| Live MCP `tools/call` find_colorado_gages | PASS | Query `Deckers` resolved first to preset `USGS-06701900` (South Platte below Brush Creek near Trumbull), plus two USGS sites whose official names include “Deckers”. |
| Copy to `~/.cursor/plugins/local/vco-river-conditions` | PASS | Real directory (not a symlink) at `~/.cursor/plugins/local/vco-river-conditions`. |
| Optional `USGS_API_KEY` | PASS (documented) | Server reads `USGS_API_KEY` from the process environment and sends `X-Api-Key` only when set. No key is committed. Agent Plugins 1.0.0 `plugin.json` has no `variables` field (closed schema), so the optional key is not declared there; see README. |
| `@anysphere/cursor-plugins loadUserLocalPlugins` | SKIPPED | Package is not on the public npm registry (same as 0.1.0). |

## Endpoints used

- `https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items`
- `https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items`
- `https://api.waterdata.usgs.gov/ogcapi/v1/collections/monitoring-locations/items`

Query parameters confirmed live: `monitoring_location_id` (comma-separated `USGS-` IDs), `parameter_code`, `datetime` as an ISO interval `start/end` (duration strings like `P2D` return 400), `state_code=08`, `site_type_code=ST`, `id`, `limit`, `f=json`, `skipGeometry=true`. No API key was used during prove.

## Gages dropped or changed

No presets were dropped in 0.2.0. All 0.1.0 site numbers remain, rewritten as `USGS-xxxxxxxx`. Previously dropped candidates stay out (wrong Deckers IDs; Arkansas at Wellsville with stale discharge; ice-only mid-Arkansas alternatives; Colorado above Glenwood with temp only; Taylor at Taylor Park above the reservoir).

## Sample current readings (live, 14 Nov 2026, America/Denver)

From `get_river_conditions` `{ "preset": "all" }` against the OGC API.

| River | Site | Flow (cfs) | Water temp (°F) | Gage (ft) | Observed at |
| --- | --- | --- | --- | --- | --- |
| Gunnison | USGS-09128000 below Gunnison Tunnel | 205 | null | 1.40 | 2026-11-14T11:45:00-07:00 |
| Colorado | USGS-09085100 below Glenwood Springs | 1080 | null | 3.54 | 2026-11-14T11:15:00-07:00 |
| Colorado | USGS-09095500 near Cameo | 1310 | 45 | 3.36 | 2026-11-14T11:45:00-07:00 |
| Colorado | USGS-09163500 near CO-UT state line | 2940 | 47.7 | 3.49 | 2026-11-14T11:45:00-07:00 |
| Roaring Fork | USGS-09085000 at Glenwood Springs | 517 | 42.3 | 1.80 | 2026-11-14T11:45:00-07:00 |
| Frying Pan | USGS-09080400 near Ruedi | 39.3 | null | 0.93 | 2026-11-14T11:15:00-07:00 |
| South Platte | USGS-06701900 near Trumbull (Deckers) | 90.5 | null | 3.12 | 2026-11-14T11:45:00-07:00 |
| Yampa | USGS-09239500 at Steamboat Springs | 107 | 42.4 | 1.21 | 2026-11-14T11:15:00-07:00 |

`null` means the gage does not currently report that parameter, or the latest value is sentinel/seasonal/older than 48 hours. Numbers were not invented. USGS values are provisional.

## Summary

All required prove steps **PASS**. `@anysphere/cursor-plugins loadUserLocalPlugins` remains **SKIPPED** because the package is not obtainable.
