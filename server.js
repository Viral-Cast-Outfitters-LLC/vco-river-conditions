#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency stdio MCP server for vco-river-conditions.
 * JSON-RPC 2.0 over newline-delimited stdin/stdout, with Content-Length
 * (MCP stdio) framing also supported. Logs go to stderr only.
 *
 * Data source: USGS Water Data OGC API (api.waterdata.usgs.gov), no auth
 * by default. Optional USGS_API_KEY is read from the process environment.
 */

const fs = require("fs");
const path = require("path");

const VERSION = "0.2.0";
const SERVER_NAME = "vco-river-conditions";
const PROTOCOL_VERSION = "2024-11-05";
const UA = `vco-river-conditions/${VERSION} (Viral Cast Outfitters; fishing reports)`;
const OGC_BASE = "https://api.waterdata.usgs.gov/ogcapi/v1/collections";
const SENTINEL = -999999;
const FRESH_MS = 48 * 60 * 60 * 1000;
const DENVER_TZ = "America/Denver";
const PARAMS = {
  flowCfs: { code: "00060", convert: convertFlow },
  waterTempF: { code: "00010", convert: convertTempF },
  gageHeightFt: { code: "00065", convert: convertGage },
};
const PARAM_ALIASES = {
  flow: "flowCfs",
  cfs: "flowCfs",
  discharge: "flowCfs",
  "00060": "flowCfs",
  flowcfs: "flowCfs",
  temp: "waterTempF",
  temperature: "waterTempF",
  watertemp: "waterTempF",
  watertempf: "waterTempF",
  "00010": "waterTempF",
  gage: "gageHeightFt",
  height: "gageHeightFt",
  gageheight: "gageHeightFt",
  gageheightft: "gageHeightFt",
  "00065": "gageHeightFt",
};

const PRESETS = loadPresets();
const PRESET_BY_SITE = new Map();
for (const [key, p] of Object.entries(PRESETS)) {
  PRESET_BY_SITE.set(p.siteId, key);
}

let siteCache = null;
let siteCacheAt = 0;
let framing = "ndjson";

function loadPresets() {
  const file = path.join(__dirname, "presets.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function log(...args) {
  process.stderr.write(args.map(String).join(" ") + "\n");
}

function apiKey() {
  const raw = process.env.USGS_API_KEY;
  if (raw == null) return null;
  const key = String(raw).trim();
  if (!key || key === "${USGS_API_KEY}" || key.startsWith("${")) return null;
  return key;
}

function monitoringUrl(siteId) {
  return `https://waterdata.usgs.gov/monitoring-location/${siteId}/`;
}

function normalizeSiteId(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  s = s.replace(/^USGS-?/i, "");
  if (!/^\d{8,15}$/.test(s)) return null;
  return `USGS-${s}`;
}

function titleCaseRiver(name) {
  return String(name)
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function riverFromSiteName(siteName) {
  if (!siteName) return null;
  const n = String(siteName);
  const m = n.match(/^(.+?)\s+RIVER\b/i) || n.match(/^(.+?)\s+CR(?:EEK)?\b/i);
  if (m) return titleCaseRiver(m[1]);
  return titleCaseRiver(n.split(/[,\s]+/)[0]);
}

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === SENTINEL) return null;
  return n;
}

function parseIso(t) {
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

function cToF(c) {
  return Math.round((Number(c) * 9) / 5 * 10 + 320) / 10;
}

function unitNorm(unit) {
  return String(unit || "").replace(/\s+/g, "").toLowerCase();
}

function convertFlow(v) {
  return v;
}

function convertGage(v) {
  return v;
}

function convertTempF(v, unit) {
  const u = unitNorm(unit);
  if (u === "degf" || u === "°f" || u === "f" || u.includes("fahrenheit")) return Math.round(Number(v) * 10) / 10;
  // USGS parameter 00010 is Celsius (degC) unless the unit says otherwise.
  return cToF(v);
}

function toDenverIso(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second
  );
  const offsetMin = Math.round((asUtc - date.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${oh}:${om}`;
}

function resolveParam(raw) {
  if (raw == null || raw === "") return "flowCfs";
  const key = String(raw).replace(/[\s-]+/g, "").toLowerCase();
  return PARAM_ALIASES[key] || null;
}

function findPreset(token) {
  if (!token) return null;
  const raw = String(token).trim();
  if (PRESETS[raw]) return { key: raw, ...PRESETS[raw] };
  const id = normalizeSiteId(raw);
  if (id && PRESET_BY_SITE.has(id)) {
    const key = PRESET_BY_SITE.get(id);
    return { key, ...PRESETS[key] };
  }
  const q = normText(raw);
  if (!q) return null;
  const hits = [];
  for (const [key, p] of Object.entries(PRESETS)) {
    const bag = [key, p.river, p.label, p.siteId, ...(p.aliases || [])].map(normText);
    if (bag.includes(q) || bag.some((b) => b === q || b.includes(q) || q.includes(b))) {
      hits.push({ key, ...p });
    }
  }
  return hits;
}

function userError(message) {
  const err = new Error(message);
  err.user = true;
  return err;
}

function resolveConditionQuery(args) {
  const sites = new Set();
  if (Array.isArray(args.sites)) {
    for (const s of args.sites) {
      const id =
        normalizeSiteId(s) ||
        (typeof s === "string" && PRESETS[s] ? PRESETS[s].siteId : null);
      if (!id) {
        const found = findPreset(s);
        const list = Array.isArray(found) ? found : found ? [found] : [];
        if (!list.length) throw userError(`Unrecognized site: ${s}`);
        for (const p of list) sites.add(p.siteId);
      } else {
        sites.add(id);
      }
    }
  }
  const preset = args.preset == null ? null : String(args.preset).trim();
  if (preset && preset.toLowerCase() !== "custom") {
    if (normText(preset) === "all" || preset === "") {
      for (const p of Object.values(PRESETS)) sites.add(p.siteId);
    } else if (PRESETS[preset]) {
      sites.add(PRESETS[preset].siteId);
    } else {
      const found = findPreset(preset);
      const list = Array.isArray(found) ? found : found ? [found] : [];
      if (!list.length) {
        const id = normalizeSiteId(preset);
        if (id) sites.add(id);
        else throw userError(`Unknown preset or river: ${preset}`);
      } else {
        for (const p of list) sites.add(p.siteId);
      }
    }
  }
  if (!sites.size) {
    for (const p of Object.values(PRESETS)) sites.add(p.siteId);
  }
  return [...sites];
}

async function ogcFetch(url) {
  const headers = { "User-Agent": UA, Accept: "application/geo+json, application/json" };
  const key = apiKey();
  if (key) headers["X-Api-Key"] = key;
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    throw userError(
      "USGS Water Data API rate limit (HTTP 429). Set the USGS_API_KEY environment variable to a free api.data.gov key for higher limits. See https://api.waterdata.usgs.gov/docs/ogcapi/keys/"
    );
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const desc = body && (body.description || body.detail || body.title);
    throw userError(
      `USGS request failed (${res.status})${desc ? `: ${desc}` : ""}${!body && text ? `: ${text.slice(0, 200)}` : ""}`
    );
  }
  return body;
}

function withParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function ogcItems(collection, params, { maxPages = 20 } = {}) {
  let url = withParams(`${OGC_BASE}/${collection}/items`, {
    f: "json",
    skipGeometry: "true",
    ...params,
  });
  const features = [];
  for (let page = 0; page < maxPages && url; page++) {
    const body = await ogcFetch(url);
    const batch = body?.features || [];
    features.push(...batch);
    const next = (body?.links || []).find((l) => l.rel === "next" && l.href);
    url = next ? next.href : null;
  }
  return features;
}

function featureProps(f) {
  return (f && f.properties) || {};
}

function groupLatest(features) {
  const bySite = new Map();
  for (const f of features) {
    const p = featureProps(f);
    const siteId = p.monitoring_location_id || f.id;
    if (!siteId) continue;
    if (!bySite.has(siteId)) {
      bySite.set(siteId, {
        siteId,
        siteName: p.monitoring_location_name || null,
        series: {},
      });
    }
    const rec = bySite.get(siteId);
    if (p.monitoring_location_name) rec.siteName = p.monitoring_location_name;
    const code = p.parameter_code;
    if (!code) continue;
    if (!rec.series[code]) rec.series[code] = [];
    rec.series[code].push({
      value: p.value,
      time: p.time,
      unit: p.unit_of_measure,
      qualifier: p.qualifier,
      statisticId: p.statistic_id,
    });
  }
  return bySite;
}

function latestFresh(rows, convert, now) {
  const sorted = [...(rows || [])].sort((a, b) => (parseIso(a.time) || 0) - (parseIso(b.time) || 0));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const row = sorted[i];
    const v = parseNumber(row.value);
    const t = row.time || null;
    const ms = parseIso(t);
    if (v == null || !ms) continue;
    if (now - ms > FRESH_MS) break;
    return { value: convert(v, row.unit), observedAt: toDenverIso(t), ms };
  }
  return { value: null, observedAt: null, ms: 0 };
}

function toReading(siteId, rec, names, now) {
  const presetKey = PRESET_BY_SITE.get(siteId);
  const preset = presetKey ? PRESETS[presetKey] : null;
  const siteName =
    rec?.siteName || names.get(siteId) || preset?.label || null;
  const flow = latestFresh(rec?.series?.["00060"] || [], PARAMS.flowCfs.convert, now);
  const temp = latestFresh(rec?.series?.["00010"] || [], PARAMS.waterTempF.convert, now);
  const gage = latestFresh(rec?.series?.["00065"] || [], PARAMS.gageHeightFt.convert, now);
  const observed = [flow, temp, gage].reduce(
    (best, cur) => (cur.ms > best.ms ? cur : best),
    { ms: 0, observedAt: null }
  );
  return {
    siteId,
    siteName,
    river: preset?.river || riverFromSiteName(siteName),
    flowCfs: flow.value,
    waterTempF: temp.value,
    gageHeightFt: gage.value,
    observedAt: observed.observedAt,
    url: monitoringUrl(siteId),
  };
}

async function lookupNames(ids) {
  const names = new Map();
  for (const id of ids) {
    const key = PRESET_BY_SITE.get(id);
    if (key) names.set(id, PRESETS[key].label);
  }
  const missing = ids.filter((id) => !names.has(id) || PRESET_BY_SITE.has(id));
  // Always ask USGS for official station names when we can.
  try {
    if (ids.length) {
      const features = await ogcItems("monitoring-locations", {
        id: ids.join(","),
        limit: Math.max(ids.length, 10),
      });
      for (const f of features) {
        const p = featureProps(f);
        const id = p.id || f.id;
        const name = p.monitoring_location_name;
        if (id && name) names.set(id, name);
      }
    }
  } catch (err) {
    log("name lookup failed", err && err.message ? err.message : err);
  }
  void missing;
  return names;
}

async function getRiverConditions(args) {
  const ids = resolveConditionQuery(args || {});
  const features = await ogcItems("latest-continuous", {
    monitoring_location_id: ids.join(","),
    parameter_code: "00060,00010,00065",
    limit: 1000,
  });
  const bySite = groupLatest(features);
  const names = await lookupNames(ids);
  const now = Date.now();
  return ids.map((id) => toReading(id, bySite.get(id), names, now));
}

function pickValueNear(points, targetMs, slackMs) {
  let best = null;
  let bestDelta = Infinity;
  for (const p of points) {
    const ms = parseIso(p.t);
    if (ms == null) continue;
    const d = Math.abs(ms - targetMs);
    if (d < bestDelta) {
      bestDelta = d;
      best = p;
    }
  }
  if (!best || bestDelta > slackMs) return null;
  return best.v;
}

async function getRiverTrend(args) {
  args = args || {};
  let siteId = normalizeSiteId(args.site);
  if (!siteId) {
    const found = findPreset(args.site);
    const list = Array.isArray(found) ? found : found ? [found] : [];
    if (list.length === 1) siteId = list[0].siteId;
    else if (list.length > 1) {
      throw userError(
        `Ambiguous site "${args.site}". Use a site ID or a more specific preset: ${list
          .map((p) => `${p.key} (${p.siteId})`)
          .join(", ")}`
      );
    }
  }
  if (!siteId) throw userError("site is required (USGS site ID or preset key)");
  const paramKey = resolveParam(args.param);
  if (!paramKey) {
    throw userError(`Unknown param "${args.param}". Use flow, temp, or gage.`);
  }
  let days = args.days == null || args.days === "" ? 1 : Number(args.days);
  if (!Number.isFinite(days)) throw userError("days must be a number");
  days = Math.min(7, Math.max(1, Math.round(days)));
  const spec = PARAMS[paramKey];
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const features = await ogcItems("continuous", {
    monitoring_location_id: siteId,
    parameter_code: spec.code,
    datetime: `${start.toISOString()}/${end.toISOString()}`,
    limit: 10000,
  });
  const rows = features
    .map((f) => featureProps(f))
    .sort((a, b) => (parseIso(a.time) || 0) - (parseIso(b.time) || 0));
  const points = [];
  for (const row of rows) {
    const v = parseNumber(row.value);
    if (v == null || !row.time) continue;
    points.push({ t: toDenverIso(row.time), v: spec.convert(v, row.unit_of_measure) });
  }
  const nums = points.map((p) => p.v);
  const latest = nums.length ? nums[nums.length - 1] : null;
  const lastT = points.length ? points[points.length - 1].t : null;
  const lastMs = parseIso(lastT);
  const change24h =
    latest == null || lastMs == null
      ? null
      : (() => {
          const prior = pickValueNear(points, lastMs - 24 * 60 * 60 * 1000, 3 * 60 * 60 * 1000);
          return prior == null ? null : Math.round((latest - prior) * 1000) / 1000;
        })();
  return {
    siteId,
    param: paramKey,
    points,
    min: nums.length ? Math.min(...nums) : null,
    max: nums.length ? Math.max(...nums) : null,
    latest,
    change24h,
  };
}

async function loadColoradoSites() {
  const now = Date.now();
  if (siteCache && now - siteCacheAt < 60 * 60 * 1000) return siteCache;
  const [locations, latest] = await Promise.all([
    ogcItems(
      "monitoring-locations",
      {
        state_code: "08",
        site_type_code: "ST",
        limit: 10000,
      },
      { maxPages: 5 }
    ),
    ogcItems(
      "latest-continuous",
      {
        state_code: "08",
        site_type_code: "ST",
        parameter_code: "00060,00010,00065",
        limit: 10000,
      },
      { maxPages: 5 }
    ),
  ]);
  const active = new Set();
  for (const f of latest) {
    const id = featureProps(f).monitoring_location_id;
    if (id) active.add(id);
  }
  const sites = [];
  for (const f of locations) {
    const p = featureProps(f);
    const siteId = p.id || f.id;
    if (!siteId) continue;
    sites.push({
      siteId,
      siteName: p.monitoring_location_name || null,
      river: riverFromSiteName(p.monitoring_location_name),
      url: monitoringUrl(siteId),
      hasContinuous: active.has(siteId),
    });
  }
  siteCache = { sites, active };
  siteCacheAt = now;
  return siteCache;
}

async function findColoradoGages(args) {
  args = args || {};
  const query = String(args.query ?? args.river ?? "").trim();
  if (!query) throw userError("Provide query or river (a name, alias, or USGS site ID)");
  const id = normalizeSiteId(query);
  const q = normText(query);
  const results = [];
  const seen = new Set();

  function push(item, reason) {
    if (!item?.siteId || seen.has(item.siteId)) return;
    seen.add(item.siteId);
    const presetKey = PRESET_BY_SITE.get(item.siteId) || null;
    results.push({
      siteId: item.siteId,
      siteName: item.siteName || (presetKey && PRESETS[presetKey].label) || null,
      river: item.river || (presetKey && PRESETS[presetKey].river) || riverFromSiteName(item.siteName),
      url: item.url || monitoringUrl(item.siteId),
      preset: presetKey,
      hasContinuous: item.hasContinuous ?? null,
      match: reason,
    });
  }

  if (id) {
    try {
      const features = await ogcItems("monitoring-locations", { id, limit: 5 });
      for (const f of features) {
        const p = featureProps(f);
        push(
          {
            siteId: p.id || f.id,
            siteName: p.monitoring_location_name,
            river: riverFromSiteName(p.monitoring_location_name),
          },
          "siteId"
        );
      }
    } catch (err) {
      log("id lookup failed", err && err.message ? err.message : err);
    }
  }

  for (const [key, p] of Object.entries(PRESETS)) {
    const bag = [key, p.river, p.label, p.siteId, ...(p.aliases || [])].map(normText);
    if (bag.some((b) => b === q || b.includes(q) || q.includes(b))) {
      push({ siteId: p.siteId, siteName: p.label, river: p.river, hasContinuous: true }, "preset");
    }
  }

  const { sites } = await loadColoradoSites();
  for (const s of sites) {
    const name = normText(s.siteName);
    const river = normText(s.river);
    const hay = `${name} ${s.siteId.toLowerCase()}`;
    if (
      s.siteId === id ||
      name.includes(q) ||
      river === q ||
      river.includes(q) ||
      (q.includes(river) && river.length >= 4) ||
      hay.includes(q)
    ) {
      push(s, "usgs");
    }
  }

  results.sort((a, b) => {
    const ap = a.preset ? 0 : 1;
    const bp = b.preset ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ac = a.hasContinuous ? 0 : 1;
    const bc = b.hasContinuous ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return (a.siteName || "").localeCompare(b.siteName || "");
  });
  const cap = 40;
  const trimmed = results.slice(0, cap);
  return { query, count: trimmed.length, totalMatches: results.length, gages: trimmed };
}

const TOOLS = [
  {
    name: "get_river_conditions",
    description:
      "Current Colorado river conditions as RiverReading objects: siteId (USGS-xxxxxxxx), siteName, river, flowCfs, waterTempF, gageHeightFt, observedAt (ISO with America/Denver offset), url. Pass preset (key, river name, or \"all\") and/or sites (USGS IDs). Defaults to the verified VCO fishing preset list. Missing parameters, seasonal/ice-affected series, and the USGS sentinel -999999 are null; values older than 48 hours are treated as stale and returned as null. Never invents numbers. Data from USGS Water Data APIs; many values are provisional and subject to revision.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sites: {
          type: "array",
          items: { type: "string" },
          description: "USGS monitoring location IDs (USGS-09128000 or 09128000) or preset keys",
        },
        preset: {
          type: "string",
          description:
            'Preset key (e.g. fryingpan-below-ruedi), river name (e.g. Gunnison), alias (Deckers), site ID, or "all"',
        },
      },
    },
  },
  {
    name: "get_river_trend",
    description:
      "Recent trend for one gage as a RiverTrend: siteId, param (flowCfs|waterTempF|gageHeightFt), points [{t,v}] with America/Denver timestamps, min, max, latest, change24h. days is 1–7 (default 1). site is a USGS ID or preset key. Nulls are omitted from points; change24h is null if no comparable point exists ~24 hours before the latest reading. Data from USGS; often provisional.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["site"],
      properties: {
        site: {
          type: "string",
          description: "USGS site ID (USGS-09128000 or 09128000) or preset key/alias",
        },
        param: {
          type: "string",
          description: "flow (00060 cfs), temp (00010, returned in °F), or gage (00065 ft). Default flow.",
        },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 7,
          description: "Lookback window, 1–7 days. Default 1.",
        },
      },
    },
  },
  {
    name: "find_colorado_gages",
    description:
      "Search Colorado stream (ST) monitoring locations. Matches official USGS names, river names, VCO preset aliases (Deckers, Ruedi, Cameo, Glenwood, Cheesman), or a site ID (USGS-xxxxxxxx). Returns compact gage objects (siteId, siteName, river, url, preset, hasContinuous), not raw USGS JSON. Results with current continuous data are sorted first after presets.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "Name, river, alias, or USGS site ID",
        },
        river: {
          type: "string",
          description: "River name (alias for query)",
        },
      },
    },
  },
];

const handlers = {
  get_river_conditions: getRiverConditions,
  get_river_trend: getRiverTrend,
  find_colorado_gages: findColoradoGages,
};

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function fail(id, code, message, data) {
  const err = { jsonrpc: "2.0", id, error: { code, message } };
  if (data !== undefined) err.error.data = data;
  return err;
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== "2.0") {
    return fail(msg && "id" in msg ? msg.id : null, -32600, "Invalid Request");
  }
  if (msg.method && String(msg.method).startsWith("notifications/")) {
    return null;
  }
  if (msg.id === undefined || msg.id === null) return null;
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions:
          "Colorado river conditions from the USGS Water Data OGC API. Use get_river_conditions, get_river_trend, and find_colorado_gages. Never invent missing values. USGS data are often provisional and subject to revision.",
      });
    }
    if (method === "ping") return ok(id, {});
    if (method === "tools/list") return ok(id, { tools: TOOLS });
    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments || {};
      const fn = handlers[name];
      if (!fn) {
        return ok(id, {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
        });
      }
      const result = await fn(args);
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    }
    return fail(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (err && err.user) {
      return ok(id, {
        isError: true,
        content: [{ type: "text", text: message }],
      });
    }
    log("internal error", message);
    if (method === "tools/call") {
      return ok(id, {
        isError: true,
        content: [{ type: "text", text: `Tool failed: ${message}` }],
      });
    }
    return fail(id, -32603, message);
  }
}

function writeMessage(obj) {
  if (obj == null) return;
  const body = JSON.stringify(obj);
  if (framing === "lsp") {
    const payload = Buffer.from(body, "utf8");
    process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
    process.stdout.write(payload);
  } else {
    process.stdout.write(body + "\n");
  }
}

function extractLsp(buffer) {
  const messages = [];
  let rest = buffer;
  while (true) {
    const split = rest.search(/\r?\n\r?\n/);
    if (split < 0) break;
    const header = rest.slice(0, split);
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = Number(m[1]);
    const nl = rest[split] === "\r" ? 4 : 2;
    const start = split + nl;
    const raw = rest.slice(start);
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes < len) break;
    const all = Buffer.from(rest, "utf8");
    const headerBytes = Buffer.byteLength(rest.slice(0, start), "utf8");
    const body = all.subarray(headerBytes, headerBytes + len).toString("utf8");
    rest = all.subarray(headerBytes + len).toString("utf8");
    if (body.trim()) {
      try {
        messages.push(JSON.parse(body));
      } catch (err) {
        messages.push({ _parseError: err.message });
      }
    }
  }
  return { messages, rest };
}

function extractNdjson(buffer) {
  const messages = [];
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch (err) {
      messages.push({ _parseError: err.message, _raw: line });
    }
  }
  return { messages, rest };
}

function detectFraming(buffer) {
  const start = buffer.replace(/^\uFEFF/, "").trimStart();
  if (/^Content-Length:/i.test(start)) return "lsp";
  if (start.startsWith("{")) return "ndjson";
  return null;
}

async function main() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  let detected = false;
  const queue = [];
  let busy = false;
  let ended = false;

  async function drain() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const msg = queue.shift();
        if (msg && msg._parseError) {
          writeMessage(fail(null, -32700, `Parse error: ${msg._parseError}`));
          continue;
        }
        const response = await handleMessage(msg);
        writeMessage(response);
      }
    } finally {
      busy = false;
      if (ended) process.exit(0);
    }
  }

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    if (!detected) {
      const mode = detectFraming(buffer);
      if (!mode) return;
      framing = mode;
      detected = true;
    }
    const extracted = framing === "lsp" ? extractLsp(buffer) : extractNdjson(buffer);
    buffer = extracted.rest;
    for (const msg of extracted.messages) queue.push(msg);
    drain().catch((err) => log("drain failed", err && err.stack ? err.stack : err));
  });

  process.stdin.on("end", () => {
    if (buffer.trim()) {
      if (!detected) {
        const mode = detectFraming(buffer);
        if (mode) framing = mode;
      }
      try {
        queue.push(JSON.parse(buffer));
      } catch {
        // trailing partial input; ignore on shutdown
      }
      buffer = "";
    }
    ended = true;
    drain().catch((err) => {
      log("drain failed", err && err.stack ? err.stack : err);
      process.exit(1);
    });
  });
}

if (require.main === module) {
  main().catch((err) => {
    log(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  getRiverConditions,
  getRiverTrend,
  findColoradoGages,
  PRESETS,
  toDenverIso,
};
