const mangayomiSources = [{
    "name": "黄果视频",
    "lang": "zh",
    "baseUrl": "https://huangguo.video",
    "apiUrl": "",
    "iconUrl": "https://huangguo.video/favicon.ico",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "version": "0.0.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "hasCloudflare": true
}];

// Ported from the guoapp module "huangguo-video" (module.exports + global
// `host`) to the Mangayomi MProvider shape.
//
// This module parses the site with regular expressions over the response body,
// so the parsing code carries over unchanged. What changed:
//
//   1. host.fetchText/host.fetch were synchronous; Client is asynchronous, so
//      the functions that fetch are async and await.
//   2. host.parseUrl and host.resolveUrl became parseAddress and
//      resolveUrlLocal below; utf8/base64 come from the runtime.
//   3. host.cacheGet/cacheSet/exclusive/finishMedia are local shims: a Map,
//      a direct call, and the identity. guoapp's mediaAuthorization and
//      rejectMediaAuthorization hooks have no equivalent here — the token they
//      fetched is attached as a header on the video entry instead.
//
// The site sits behind Cloudflare: the app's own client gets a 403 challenge
// page, so hasCloudflare is set and the app offers to solve it in a WebView.


const siteBaseUrl = "https://huangguo.video";
const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1";
const channel = "huangguo.video";
const sourceAliases = ["huangguo-video", "huangguo.video"];

const videoCardPattern = /<article\b[^>]*class=["'][^"']*\bvideo-card\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi;
const cardMetaPattern = /<p\b[^>]*class=["'][^"']*\bfont-mono-meta\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i;
const detailMetaPattern = /<\/h1>[\s\S]*?<p\b[^>]*class=["'][^"']*\bfont-mono-meta\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i;
const anyArticlePattern = /<article\b[^>]*>[\s\S]*?<\/article>/gi;
const linkPattern = /<a\b[^>]*href=["']([^"']*\/(?:series|video)\/([^"'/?#]+)[^"']*)["'][^>]*>[\s\S]*?<\/a>/i;
const linkPatternAll = new RegExp(linkPattern.source, "gi");
const dataHlsPattern = /data-hls=["']([^"']+)["']/i;
const jsonLdPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const metaTagPattern = /<meta\b[^>]*>/gi;
const nonContentPattern = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const htmlTagPattern = /<(\/?)([a-z][a-z0-9:-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const titleTagPattern = /<title[^>]*>([\s\S]*?)<\/title>/i;
const headingPattern = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const ogTitlePattern = /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i;
const descriptionPattern = /<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["'][^>]*>/i;
const tagPattern = /<[^>]+class=["'][^"']*hg-tag[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
const episodeNumberPattern = /(?:第\s*0*(\d+)\s*(?:集|话|期)|(?:更新至|共|全)\s*0*(\d+)\s*(?:集|话|期)|(?:episode|ep)\s*#?\s*0*(\d+))/i;
const viewsPattern = /[0-9]+(?:\.[0-9]+)?\s*[w万]?\s*次播放/i;
const datePattern = /\d{4}-\d{1,2}-\d{1,2}/;
const finishedRemarkPattern = /(?:全\s*\d+\s*集|\d+\s*集全|已完结|大结局)/;
const sourceIdPattern = /^[a-zA-Z0-9_-]{1,100}$/;

// The host used to supply these; they are local now.
const sourceName = sourceAliases[0];
const __cache = new Map();

function cacheGet(key) {
  return __cache.has(key) ? __cache.get(key) : null;
}

function cacheSet(key, value) {
  if (value === null || value === undefined) {
    __cache.delete(key);
  } else {
    __cache.set(key, value);
  }
}

// One caller at a time in the host; the app's JS runtime is single threaded,
// so calling straight through is equivalent here.
function exclusive(callback) {
  return callback();
}

function finishMedia(media) {
  return media;
}

function dramaId(sourceId) {
  return sourceName + ":" + sourceId;
}

function chapterId(sourceId, key) {
  return sourceName + ":" + sourceId + ":" + key;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function htmlUnescape(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (entity, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return Object.prototype.hasOwnProperty.call(named, body) ? named[body] : entity;
  });
}

function cleanText(text) {
  text = text.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return htmlUnescape(text).replace(/[\t\n\f\r ]+/g, " ").trim();
}

function quoteMeta(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allMatches(pattern, text) {
  const found = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    found.push(match);
    if (match[0] === "") {
      pattern.lastIndex++;
    }
  }
  return found;
}

function extractAttr(block, ...names) {
  for (const name of names) {
    const match = block.match(new RegExp("\\b" + quoteMeta(name) + "\\s*=\\s*[\"']([^\"']+)[\"']", "i"));
    if (match) {
      return htmlUnescape(match[1]).trim();
    }
  }
  return "";
}

function classText(raw, className) {
  if (className === "") {
    return "";
  }
  const match = raw.match(new RegExp("<[^>]+class=[\"'][^\"']*" + quoteMeta(className) + "[^\"']*[\"'][^>]*>([\\s\\S]*?)</[^>]+>", "i"));
  return match ? cleanText(match[1]) : "";
}

function pageTitle(body) {
  const heading = body.match(headingPattern);
  if (heading) {
    const text = cleanText(heading[1]);
    if (text !== "") {
      return text;
    }
  }
  const og = body.match(ogTitlePattern);
  if (og) {
    const text = htmlUnescape(og[1]).trim();
    if (text !== "") {
      return text;
    }
  }
  const title = body.match(titleTagPattern);
  return title ? cleanText(title[1]) : "";
}

function pageDescription(body) {
  const match = body.match(descriptionPattern);
  return match ? htmlUnescape(match[1]).trim() : "";
}

function pageTags(body) {
  const tags = [];
  for (const match of allMatches(tagPattern, body)) {
    const value = cleanText(match[1]);
    if (value !== "" && !tags.includes(value)) {
      tags.push(value);
    }
  }
  return tags;
}

function releaseStatusFromRemark(remark) {
  if (remark.includes("未完结") || remark.includes("更新至") || remark.includes("连载")) {
    return "ongoing";
  }
  if (finishedRemarkPattern.test(remark) || remark.includes("完结")) {
    return "finished";
  }
  return "unknown";
}

function episodeIndex(text, fallback) {
  const match = text.match(episodeNumberPattern);
  if (match) {
    for (const group of match.slice(1)) {
      if (group !== undefined && group !== "") {
        const number = parseInt(group, 10);
        if (number > 0) {
          return number;
        }
      }
    }
  }
  return fallback;
}

function normalizeViews(text) {
  text = text.trim();
  if (text === "") {
    return "";
  }
  if (text.includes("次播放")) {
    return text;
  }
  if (/[w万]/.test(text.toLowerCase())) {
    return text + "次播放";
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    return text;
  }
  const number = Number(text);
  return number <= 0 ? "" : String(number) + "次播放";
}

function firstMatchText(pattern, text) {
  const match = text.match(pattern);
  return match ? match[0].trim() : "";
}

function pad2(value) {
  return value < 10 ? "0" + value : String(value);
}

function normalizeDate(text) {
  const matches = String(text).trim().match(/\d{4}-\d{1,2}-\d{1,2}/g) || [];
  for (const match of matches) {
    const [year, month, day] = match.split("-").map((part) => parseInt(part, 10));
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return year + "-" + pad2(month) + "-" + pad2(day);
    }
  }
  return "";
}

function validDate(date) {
  const [year, month, day] = date.split("-").map((part) => parseInt(part, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function releaseDate(value) {
  value = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const stamp = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
    if (!isNaN(stamp)) {
      const date = new Date(stamp + 8 * 3600 * 1000);
      value = date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate());
    }
  }
  const date = normalizeDate(value);
  return date !== "" && validDate(date) ? date : "";
}

function parseAddress(raw) {
  const text = String(raw || "").trim();
  const match = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/([^\/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(text);
  if (!match) {
    return text === "" ? null : { scheme: "", host: "", hostname: "", port: "", path: text, query: "", fragment: "", userInfo: "", href: text };
  }
  const authority = match[2];
  const userInfo = authority.indexOf("@") >= 0 ? authority.slice(0, authority.indexOf("@")) : "";
  let host = userInfo === "" ? authority : authority.slice(authority.indexOf("@") + 1);
  let port = "";
  const colon = host.lastIndexOf(":");
  if (colon >= 0 && host.indexOf("]") < 0) {
    port = host.slice(colon + 1);
    host = host.slice(0, colon);
  }
  return {
    scheme: match[1].toLowerCase(),
    host: host,
    hostname: host.toLowerCase(),
    port: port,
    path: match[3] || "/",
    query: match[4] || "",
    fragment: match[5] || "",
    userInfo: userInfo,
    href: text,
  };
}

// Absolute-URL resolution, what host.resolveUrl used to do.
function resolveUrlLocal(base, ref) {
  ref = String(ref || "").trim();
  if (ref === "") return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(ref)) return ref;
  if (ref.startsWith("//")) return "https:" + ref;
  const baseAddress = parseAddress(base);
  if (!baseAddress || baseAddress.scheme === "") return ref;
  const originText = baseAddress.scheme + "://" + baseAddress.host;
  if (ref.startsWith("/")) return originText + ref;
  if (ref.startsWith("?")) return originText + baseAddress.path + ref;
  const slash = baseAddress.path.lastIndexOf("/");
  const directory = slash >= 0 ? baseAddress.path.slice(0, slash + 1) : "/";
  const output = [];
  for (const segment of (directory + ref).split("/")) {
    if (segment === "..") {
      if (output.length > 1) output.pop();
    } else if (segment !== ".") {
      output.push(segment);
    }
  }
  let path = output.join("/");
  if (!path.startsWith("/")) path = "/" + path;
  return originText + path;
}

function httpAddress(raw) {
  const parsed = parseAddress(String(raw).trim());
  return parsed !== null && (parsed.scheme === "http" || parsed.scheme === "https") && parsed.hostname !== "" && !parsed.userInfo;
}

function resolveUrl(base, ref) {
  ref = htmlUnescape(String(ref || "")).trim();
  if (ref === "") {
    return "";
  }
  ref = ref.replace(/\\\//g, "/");
  if (ref.startsWith("//")) {
    return "https:" + ref;
  }
  const parsed = parseAddress(ref);
  if (!parsed) {
    return ref;
  }
  let resolved = parsed.href;
  if (parsed.scheme === "") {
    try {
      resolved = resolveUrlLocal(base, ref);
    } catch (error) {
      return ref;
    }
  }
  return resolved.replace(/^http:/, "https:");
}

function goUnquote(text) {
  if (text.includes("\n")) {
    return null;
  }
  const simple = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 };
  const bytes = [];
  const pushText = (value) => {
    for (const byte of utf8Encode(value)) {
      bytes.push(byte);
    }
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      return null;
    }
    if (character !== "\\") {
      pushText(character);
      continue;
    }
    const escape = text[++index];
    if (escape === undefined) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(simple, escape)) {
      bytes.push(simple[escape]);
    } else if (escape === "x") {
      const hex = text.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        return null;
      }
      bytes.push(parseInt(hex, 16));
      index += 2;
    } else if (escape === "u" || escape === "U") {
      const size = escape === "u" ? 4 : 8;
      const hex = text.slice(index + 1, index + 1 + size);
      const code = /^[0-9a-fA-F]+$/.test(hex) && hex.length === size ? parseInt(hex, 16) : -1;
      if (code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return null;
      }
      pushText(String.fromCodePoint(code));
      index += size;
    } else if (escape >= "0" && escape <= "7") {
      const octal = text.slice(index, index + 3);
      if (!/^[0-7]{3}$/.test(octal) || parseInt(octal, 8) > 255) {
        return null;
      }
      bytes.push(parseInt(octal, 8));
      index += 2;
    } else {
      return null;
    }
  }
  return utf8Decode(bytes);
}

function normalizeMediaUrl(pageUrl, raw) {
  raw = htmlUnescape(String(raw || "")).trim().replace(/^[ \t\r\n"']+|[ \t\r\n"']+$/g, "");
  if (raw === "") {
    return "";
  }
  const unquoted = goUnquote(raw.replace(/"/g, '\\"'));
  if (unquoted !== null) {
    raw = unquoted;
  }
  raw = raw.replace(/\\\//g, "/");
  const resolved = resolveUrl(pageUrl, raw);
  const lower = resolved.toLowerCase();
  return lower.includes(".m3u8") || lower.includes(".mp4") ? resolved : "";
}

function coverAddress(value, pageUrl) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = coverAddress(entry, pageUrl);
      if (found !== "") {
        return found;
      }
    }
  } else if (isRecord(value)) {
    for (const key of ["url", "contentUrl", "thumbnailUrl"]) {
      const found = coverAddress(value[key], pageUrl);
      if (found !== "") {
        return found;
      }
    }
  } else if (typeof value === "string" && value.trim() !== "") {
    let resolved;
    try {
      resolved = resolveUrlLocal(pageUrl, value.trim());
    } catch (error) {
      return "";
    }
    if (httpAddress(resolved)) {
      return resolved;
    }
  }
  return "";
}

function percentDecode(text, plusIsSpace) {
  if (/%(?![0-9a-fA-F]{2})/.test(text)) {
    return null;
  }
  const bytes = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "%") {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (plusIsSpace && character === "+") {
      bytes.push(32);
    } else {
      for (const byte of utf8Encode(character)) {
        bytes.push(byte);
      }
    }
  }
  return utf8Decode(bytes);
}

function queryValue(query, name) {
  for (const part of query.split("&")) {
    if (part === "" || part.includes(";")) {
      continue;
    }
    const separator = part.indexOf("=");
    const key = percentDecode(separator < 0 ? part : part.slice(0, separator), true);
    const value = percentDecode(separator < 0 ? "" : part.slice(separator + 1), true);
    if (key === name && value !== null) {
      return value;
    }
  }
  return "";
}

function queryEscape(text) {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

function validCategory(category) {
  return /^[+-]?\d+$/.test(category) && parseInt(category, 10) > 0;
}

async function fetchText(address, referer) {
  const res = await new Client({ 'useDartHttpClient': true }).get(address, {
    "User-Agent": userAgent,
    "Referer": referer || siteBaseUrl + "/",
  });
  return res.body;
}

function cleanId(text) {
  text = htmlUnescape(text).trim().replace(/^[ /\t\r\n"']+|[ /\t\r\n"']+$/g, "");
  const cut = text.search(/[?#]/);
  return cut < 0 ? text : text.slice(0, cut);
}

function videoSourceId(href) {
  const parsed = parseAddress(htmlUnescape(href));
  const path = (parsed ? parsed.path : href).replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  for (let index = 0; index + 1 < parts.length; index++) {
    if (parts[index] === "series" || parts[index] === "video") {
      const code = cleanId(parts[index + 1]);
      return code === "" ? "" : parts[index] + "/" + code;
    }
  }
  return "";
}

function dataHls(raw, pageUrl) {
  const match = raw.match(dataHlsPattern);
  return match ? normalizeMediaUrl(pageUrl, match[1]) : "";
}

function elementBlock(raw, start, end, tag) {
  let depth = 1;
  const rest = raw.slice(end);
  for (const match of allMatches(htmlTagPattern, rest)) {
    if (match[2].toLowerCase() !== tag.toLowerCase()) {
      continue;
    }
    if (match[1] !== "") {
      depth--;
    } else if (!match[0].trim().endsWith("/>")) {
      depth++;
    }
    if (depth === 0) {
      return raw.slice(start, end + match.index + match[0].length);
    }
  }
  return raw.slice(start, end);
}

function classBlock(raw, className) {
  for (const match of allMatches(htmlTagPattern, raw)) {
    if (match[1] !== "") {
      continue;
    }
    if (extractAttr(match[0], "class").split(/[\t\n\f\r ]+/).includes(className)) {
      return elementBlock(raw, match.index, match.index + match[0].length, match[2]);
    }
  }
  return "";
}

function stringField(value) {
  return value === undefined || value === null || typeof value === "string";
}

function jsonLdEntry(value) {
  if (value === null) {
    return {};
  }
  if (!isRecord(value) || !["@type", "@id", "url", "name", "datePublished", "uploadDate"].every((key) => stringField(value[key]))) {
    return null;
  }
  return value;
}

function jsonLdRows(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return null;
  }
  const entry = jsonLdEntry(value);
  if (entry === null) {
    return null;
  }
  const graph = entry["@graph"];
  const rows = [];
  if (graph !== undefined && graph !== null) {
    if (!Array.isArray(graph)) {
      return null;
    }
    for (const item of graph) {
      const row = jsonLdEntry(item);
      if (row === null) {
        return null;
      }
      rows.push(row);
    }
  }
  rows.push(entry);
  return rows;
}

function sameSourceHost(address) {
  return sourceAliases.includes(address.hostname.toLowerCase());
}

function sortDetail(body, pageUrl, patch) {
  const expected = parseAddress(pageUrl);
  const trimPath = (path) => path.replace(/\/+$/, "");
  let matched = false;
  for (const block of allMatches(jsonLdPattern, body)) {
    const rows = jsonLdRows(block[1]);
    if (rows === null) {
      continue;
    }
    for (const row of rows) {
      const type = row["@type"] || "";
      if (!["WebPage", "VideoObject", "TVSeries", "Movie"].includes(type)) {
        continue;
      }
      const name = row.name || "";
      const actual = parseAddress(firstNonEmpty(row.url || "", row["@id"] || ""));
      if (!actual || (actual.host !== "" && actual.host.toLowerCase() !== expected.host.toLowerCase() && !sameSourceHost(actual)) || trimPath(actual.path) !== trimPath(expected.path) || name === "") {
        continue;
      }
      matched = true;
      patch.title = name;
      const cover = firstNonEmpty(coverAddress(row.image, pageUrl), coverAddress(row.thumbnailUrl, pageUrl));
      if (cover !== "") {
        patch.cover = cover;
        patch.coverUrl = cover;
      }
      const date = releaseDate(firstNonEmpty(row.uploadDate || "", row.datePublished || ""));
      if (date !== "" && (!patch.onlineDate || type === "VideoObject")) {
        patch.onlineDate = date;
      }
    }
  }
  if (!matched) {
    throw new Error("黄果详情没有返回所请求剧集的元数据");
  }
  if (!patch.cover) {
    for (const match of allMatches(metaTagPattern, body)) {
      if (extractAttr(match[0], "property", "name").toLowerCase() === "og:image") {
        const cover = coverAddress(extractAttr(match[0], "content"), pageUrl);
        if (cover !== "") {
          patch.cover = cover;
          patch.coverUrl = cover;
          break;
        }
      }
    }
  }
  const meta = cleanText(classBlock(body.replace(nonContentPattern, ""), "hg-web-detail__meta"));
  patch.views = normalizeViews(firstMatchText(viewsPattern, meta));
  if (!patch.onlineDate && meta.includes("上线")) {
    patch.onlineDate = releaseDate(firstMatchText(datePattern, meta));
  }
  return patch;
}

function detailMetadata(body, pageUrl, sourceId) {
  let drama = {
    id: dramaId(sourceId),
    source: sourceName,
    sourceId,
    title: firstNonEmpty(pageTitle(body), "短剧"),
    desc: pageDescription(body),
    tags: pageTags(body),
  };
  try {
    drama = sortDetail(body, pageUrl, Object.assign({}, drama));
  } catch (error) {
    drama = Object.assign({}, drama);
  }
  drama.name = drama.title;
  drama.intro = drama.desc;
  const meta = cleanText(classBlock(body.replace(nonContentPattern, ""), "hg-web-detail__meta"));
  drama.releaseStatus = releaseStatusFromRemark(meta);
  if (drama.releaseStatus === "unknown" && !sourceId.startsWith("video/")) {
    const header = body.match(detailMetaPattern);
    if (header) {
      drama.releaseStatus = releaseStatusFromRemark(cleanText(header[1]));
    }
  }
  return drama;
}

function displayTitle(drama) {
  if ((drama.title || "").trim() !== "") {
    return drama.title;
  }
  if ((drama.name || "").trim() !== "") {
    return drama.name;
  }
  return "短剧";
}

function parseCards(raw, pageUrl) {
  let blocks = allMatches(videoCardPattern, raw).map((match) => match[0]);
  if (blocks.length === 0) {
    blocks = allMatches(anyArticlePattern, raw)
      .map((match) => match[0])
      .filter((block) => block.toLowerCase().includes("video-card"));
  }
  const seen = new Set();
  const items = [];
  for (const block of blocks) {
    const link = block.match(linkPattern);
    if (!link) {
      continue;
    }
    const sourceId = videoSourceId(link[1]);
    if (sourceId === "" || seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    const title = firstNonEmpty(extractAttr(block, "title", "alt", "aria-label"), cleanText(block));
    const cover = resolveUrl(pageUrl, extractAttr(block, "data-src", "data-original", "src"));
    const category = sourceId.startsWith("series/") ? "series" : "video";
    const description = firstNonEmpty(extractAttr(block, "data-description", "description"), pageDescription(block));
    let status = "";
    if (category === "series") {
      const meta = block.match(cardMetaPattern);
      if (meta) {
        status = releaseStatusFromRemark(cleanText(meta[1]));
      }
    }
    items.push({
      id: dramaId(sourceId),
      source: sourceName,
      sourceId,
      title,
      name: title,
      desc: description,
      intro: description,
      cover,
      coverUrl: cover,
      categoryName: category,
      channelName: channel,
      remark: firstNonEmpty(classText(block, "bg-black/55"), classText(block, "text-gold-dim")),
      releaseStatus: status,
    });
  }
  return items;
}

function nextUnusedIndex(preferred, used) {
  if (preferred <= 0) {
    preferred = 1;
  }
  if (!used.has(preferred)) {
    return preferred;
  }
  for (let index = 1; ; index++) {
    if (!used.has(index)) {
      return index;
    }
  }
}

function parseEpisodes(raw, pageUrl) {
  let blocks = allMatches(videoCardPattern, raw).map((match) => match[0]);
  if (blocks.length === 0) {
    blocks = allMatches(linkPatternAll, raw).map((match) => match[0]);
  }
  const positions = new Map();
  const episodes = [];
  let numbered = false;
  for (const block of blocks) {
    const link = block.match(linkPattern);
    if (!link) {
      continue;
    }
    const key = videoSourceId(link[1]);
    if (key === "" || !key.startsWith("video/")) {
      continue;
    }
    const fullUrl = resolveUrl(pageUrl, link[1]);
    const title = firstNonEmpty(extractAttr(block, "title"), extractAttr(block, "alt"), cleanText(block));
    const index = episodeIndex(cleanText(block), episodeIndex(title, 0));
    numbered = numbered || index > 0;
    const episode = { key, title, url: fullUrl, index, hls: dataHls(block, pageUrl) };
    if (positions.has(fullUrl)) {
      const position = positions.get(fullUrl);
      if (episodes[position].index <= 0 && index > 0) {
        episodes[position] = episode;
      }
    } else {
      positions.set(fullUrl, episodes.length);
      episodes.push(episode);
    }
  }
  const result = [];
  const used = new Set();
  for (const episode of episodes) {
    if (numbered && episode.index <= 0) {
      continue;
    }
    episode.index = nextUnusedIndex(episode.index, used);
    used.add(episode.index);
    result.push(episode);
  }
  return result
    .map((episode, position) => ({ episode, position }))
    .sort((left, right) => left.episode.index - right.episode.index || (left.episode.key < right.episode.key ? -1 : left.episode.key > right.episode.key ? 1 : left.position - right.position))
    .map((entry) => entry.episode);
}

function sortChapters(chapters) {
  return chapters
    .map((chapter, position) => ({ chapter, position }))
    .sort((left, right) => left.chapter.currentEpisode - right.chapter.currentEpisode || (left.chapter.id < right.chapter.id ? -1 : left.chapter.id > right.chapter.id ? 1 : left.position - right.position))
    .map((entry) => entry.chapter);
}

function uniqueChapters(chapters) {
  const seen = new Set();
  return chapters.filter((chapter, index) => {
    const key = chapter.id || chapter.videoUrl || "idx_" + index;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function fetchDetail(sourceId) {
  sourceId = sourceId.trim().replace(/^\/+|\/+$/g, "");
  if (sourceId === "") {
    throw new Error("empty huangguo-video sourceID");
  }
  let detailPath = sourceId;
  if (!detailPath.startsWith("series/") && !detailPath.startsWith("video/")) {
    detailPath = "series/" + detailPath;
  }
  const detailUrl = siteBaseUrl + "/" + detailPath;
  const body = await fetchText(detailUrl, siteBaseUrl + "/");
  const drama = detailMetadata(body, detailUrl, sourceId);
  const title = displayTitle(drama);
  let episodes = [];
  if (detailPath.startsWith("video/")) {
    const hls = dataHls(body, detailUrl);
    if (hls !== "") {
      episodes = [{ key: "1", title, url: detailUrl, index: 1, hls }];
    }
  } else {
    episodes = parseEpisodes(body, detailUrl);
  }
  if (episodes.length === 0) {
    const hls = dataHls(body, detailUrl);
    if (hls !== "") {
      episodes = [{ key: "1", title, url: detailUrl, index: 1, hls }];
    }
  }
  const chapters = [];
  for (const episode of episodes) {
    const index = episode.index > 0 ? episode.index : chapters.length + 1;
    chapters.push({
      id: chapterId(sourceId, episode.key || String(index)),
      source: sourceName,
      title: episode.title.trim() || "第" + index + "集",
      videoUrl: episode.hls,
      pageUrl: episode.url,
      currentEpisode: index,
    });
  }
  return { drama, chapters: uniqueChapters(sortChapters(chapters)) };
}

function previewTokenValid(token) {
  return token.length <= 4096 && !/[\r\n\t ]/.test(token);
}

function optionalInteger(value) {
  return value === undefined || value === null || Number.isInteger(value);
}

async function fetchPreviewToken(siteOrigin, referer) {
  const failure = new Error("黄果视频未返回有效播放凭证，请稍后重试");
  const headers = {
    "User-Agent": userAgent,
    Referer: referer,
    Accept: "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
  const page = parseAddress(referer);
  if (page && page.host !== "") {
    headers.Origin = page.scheme + "://" + page.host;
  }
  const res = await new Client({ 'useDartHttpClient': true }).get(siteOrigin + "/api/preview-token", headers);
  const response = { status: res.statusCode, body: res.body };
  let result;
  try {
    result = JSON.parse(response.body);
  } catch (error) {
    throw failure;
  }
  if (result === null) {
    result = {};
  }
  if (
    response.status !== 200 ||
    !isRecord(result) ||
    !(result.ok === undefined || result.ok === null || typeof result.ok === "boolean") ||
    !stringField(result.token) ||
    !optionalInteger(result.expires_at) ||
    !optionalInteger(result.expires_in) ||
    result.ok !== true ||
    !result.token ||
    !previewTokenValid(result.token)
  ) {
    throw failure;
  }
  const now = Date.now();
  let expires = now + Math.max(30, Math.min(result.expires_in || 0, 1800)) * 1000;
  if (result.expires_at > 0) {
    expires = result.expires_at * 1000;
  }
  if (expires <= now) {
    throw new Error("黄果视频返回的播放凭证已过期，请重试；反复出现时请检查设备时间");
  }
  return { token: result.token, expires };
}

function cachedToken(siteOrigin) {
  const cached = cacheGet("preview:" + siteOrigin);
  if (cached === null) {
    return null;
  }
  const session = JSON.parse(cached);
  return Date.now() + 15000 < session.expires ? session : null;
}

function addressOrigin(address) {
  const parsed = parseAddress(address);
  return parsed.scheme + "://" + parsed.host;
}


/// The value the reader picked in the category filter.
function categoryOf(filterList) {
    for (const filter of filterList || []) {
        if (!filter || filter.type !== "categories") continue;
        const values = filter.values || [];
        if (values.length === 0) continue;
        const state = typeof filter.state === "number" ? filter.state : 0;
        const pick = values[state] || values[0];
        return pick ? String(pick.value || "") : "";
    }
    return "";
}

// ── The provider ───────────────────────────────────────────────────────────

class DefaultExtension extends MProvider {
    _categories = null;

    get baseUrl() {
        return this.source.baseUrl;
    }

    async fetchPage(address, referer) {
        const body = await fetchText(address, referer || siteBaseUrl + "/");
        return { body: body, url: address };
    }

    /// Read once per session; the filter sheet needs it synchronously.
    async loadCategories() {
        if (this._categories != null) return this._categories;
        this._categories = await this.getCategories();
        return this._categories;
    }

    async getCategories() {
        const body = await fetchText(siteBaseUrl + "/videos", siteBaseUrl + "/");
        const categories = [];
        const seen = new Set();
        for (const match of allMatches(anchorPattern, body)) {
            const href = htmlUnescape(extractAttr("<a " + match[1] + ">", "href"));
            const address = parseAddress(href);
            if (!address || (address.path !== "" && address.path.replace(/\/+$/, "") !== "/videos")) continue;
            const id = queryValue(address.query, "category");
            const name = htmlUnescape(match[2].replace(/<[^>]*>/g, "")).trim();
            if (id === "" || id.length > 128 || /[|/\\\u0000\r\n]/.test(id) || !validCategory(id) ||
                seen.has(id) || name === "" || Array.from(name).length > 24) continue;
            seen.add(id);
            categories.push({ id: id, name: name });
        }
        return categories;
    }

    async catalogPage(page, category) {
        let address = siteBaseUrl + "/videos?page=" + page;
        if (category !== "" && category != null) {
            address += "&category=" + queryEscape(category);
        }
        const body = await fetchText(address, siteBaseUrl + "/");
        // parseCards speaks guoapp's field names; the app wants link/name/
        // imageUrl, and takes the link straight into getDetail.
        const items = parseCards(body, address).map((item) => ({
            name: item.title || item.name || "",
            link: item.sourceId || "",
            imageUrl: item.cover || "",
            description: item.desc || item.intro || "",
        }));
        return { list: items, hasNextPage: items.length >= 20 };
    }

    categoryOf(filterList) {
        for (const filter of filterList || []) {
            if (filter && filter.type === "categories" && filter.values && filter.values.length) {
                const state = typeof filter.state === "number" ? filter.state : 0;
                const pick = filter.values[state] || filter.values[0];
                return pick ? String(pick.value || "") : "";
            }
        }
        return "";
    }

    async getPopular(page) {
        await this.loadCategories();
        return await this.catalogPage(page, "");
    }

    async getLatestUpdates(page) {
        await this.loadCategories();
        return await this.catalogPage(page, "");
    }

    async search(query, page, filters) {
        // The site has no text search; its catalogue is category based, so the
        // filter sheet is the only thing that narrows it.
        await this.loadCategories();
        return await this.catalogPage(page, categoryOf(filters));
    }

    async getDetail(url) {
        const detail = await fetchDetail(String(url || ""));
        const drama = detail.drama || {};
        return {
            name: drama.title || drama.name || "",
            imageUrl: drama.cover || "",
            description: drama.intro || drama.desc || "",
            genre: drama.tags || [],
            author: drama.categoryName || "",
            status: 0,
            chapters: (detail.chapters || []).map((chapter) => ({
                name: chapter.title || String(chapter.currentEpisode || ""),
                url: chapter.pageUrl || chapter.videoUrl || "",
            })),
        };
    }

    async getVideoList(url) {
        const pageUrl = String(url || "");
        const media = { url: "", referer: siteBaseUrl + "/" };
        if (pageUrl !== "") {
            const body = await fetchText(pageUrl, siteBaseUrl + "/");
            media.url = dataHls(body, pageUrl);
            media.referer = pageUrl;
        }
        if (!httpAddress(media.url)) throw new Error("黄果视频未解析到播放地址");

        // The site guards its HLS keys behind a short lived preview token;
        // fetch one and hand it to the player as a request header.
        const headers = { "Referer": media.referer };
        try {
            const session = await this.previewToken(addressOrigin(media.url), pageUrl);
            if (session && session.token) headers["X-Preview-Token"] = session.token;
        } catch (error) {
            // Without a token the address may still play; let the player try.
        }

        // The player sends no custom headers of its own, so a plain address
        // would load the playlist and then fail on every segment that needs
        // the token. Route the playlist through the app's proxy, which carries
        // these headers on to the segments and keys.
        let finalUrl = media.url;
        const parsed = parseAddress(media.url);
        const isPlaylist = parsed && parsed.path.toLowerCase().endsWith(".m3u8");
        if (isPlaylist) {
            try {
                finalUrl = await createHlsProxyUrl(media.url, headers);
            } catch (error) {
                // No proxy available: the address is all that is left.
                finalUrl = media.url;
            }
        }

        return [{
            url: finalUrl,
            originalUrl: media.url,
            quality: "Origin",
            headers: headers,
        }];
    }

    async previewToken(siteOrigin, referer) {
        const cached = cachedToken(siteOrigin);
        if (cached !== null) return cached;
        const fresh = await fetchPreviewToken(siteOrigin, referer);
        cacheSet("preview:" + siteOrigin, JSON.stringify(fresh));
        return fresh;
    }

    getFilterList() {
        // The app evaluates this synchronously, so it reports what the last
        // load read. Opening the source fills the list in.
        const categories = this._categories || [{ id: "", name: "全部" }];
        return [{
            type: "categories",
            name: "分类",
            type_name: "SelectFilter",
            values: categories.map((c) => ({
                type_name: "SelectOption",
                name: c.name,
                value: c.id,
            })),
        }];
    }

    getSourcePreferences() {
        return [];
    }
}
