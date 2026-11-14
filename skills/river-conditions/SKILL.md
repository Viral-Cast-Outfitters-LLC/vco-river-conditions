---
name: river-conditions
description: >-
  Fetch live Colorado river flow (cfs), water temperature (°F), and gage height
  from the USGS Water Data API for Viral Cast Outfitters fishing reports, blog
  posts, and Water Desk. Use when an angler or writer needs current or recent
  river conditions. Never invent missing numbers.
---

# River conditions (VCO)

Call these tools whenever you need real Colorado streamgage numbers for fishing reports, blog content, or Water Desk. Do not estimate, interpolate, or invent flow, temperature, or gage height.

Data come from the USGS Water Data APIs. Many real-time values are provisional and subject to revision. Say so when you publish numbers, and quote `observedAt` plus the Water Data for the Nation `url`.

## When to call which tool

- **get_river_conditions** — current readings. Pass `preset` (a key like `fryingpan-below-ruedi`, a river name like `Gunnison`, or `all`) or an explicit `sites` array of USGS IDs (`USGS-09128000` or `09128000`). Default is the verified VCO fishing preset list.
- **get_river_trend** — rising or falling water over the last 1–7 days. Use for “is it dropping after runoff?” or “overnight bump” questions. `param` is `flow`, `temp`, or `gage`.
- **find_colorado_gages** — the site is unknown, the user named a stretch (Deckers, Cameo, Ruedi, Glenwood), or a preset is not enough. Then follow up with `get_river_conditions` using the returned `siteId`.

## Rules

- Missing parameters are normal (many gages have no water temperature). Leave them null and say the gage does not report that value. USGS `-999999`, seasonal, or ice-affected series are no data, not a real reading.
- Ice-affected or stale gages may return nulls with no current observation time. Say that. Do not backfill from memory or a nearby site unless you clearly label it as a different gage.
- Prefer these tools over recalling “typical” flows.
- Water temperature is converted from Celsius to Fahrenheit by the plugin; do not convert again.
- Site IDs in results use the `USGS-xxxxxxxx` form.
