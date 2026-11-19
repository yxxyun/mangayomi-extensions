const mangayomiSources = [{
    "name": "剧果",
    "lang": "zh",
    "baseUrl": "https://huangju.net",
    "apiUrl": "https://api.huangju.net",
    "iconUrl": "https://huangju.net/favicon.ico",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "version": "0.0.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "hasCloudflare": false
}];

// Ported from the guoapp module "huangju" (module.exports + global `host`) to
// the Mangayomi MProvider shape.
//
// This one talks to a JSON API, not the page: it fetches a guest token from
// /auth/guest, then reads /dramas, /dramas/<id> and /play/<episode> with it.
//
//   1. host.fetch was synchronous; Client is asynchronous, so request() and
//      everything above it await.
//   2. host.parseUrl / host.preserveIntegers / host.cacheGet / host.cacheSet /
//      host.exclusive are implemented below; utf8, hex and randomBytes come
//      from the runtime.
//   3. The site signs its media with CloudFront cookies that the play response
//      returns in Set-Cookie. guoapp could pass them as `credentials`; here the
//      m3u8 goes through the app's HLS proxy with those cookies attached, and
//      a plain file gets them as request headers.
const siteBaseUrl = "https://huangju.net";
const apiBaseUrl = "https://api.huangju.net";
const userAgent = "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36";
const newestCategory = "@new";
const channel = "剧果";
const tokenKey = "guest-token";
const deviceKey = "guest-device";
const signedCookieNames = ["CloudFront-Policy", "CloudFront-Signature", "CloudFront-Key-Pair-Id"];
const signedCookiePattern = /(?:^|[,;\t\n\f\r ])CloudFront-(Policy|Signature|Key-Pair-Id)[\t\n\f\r ]*=[\t\n\f\r ]*([^;,\t\n\f\r "']+)/g;


// The host used to supply these; they are local now.
const sourceName = "huangju";
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

function exclusive(callback) {
  return callback();
}

// Keeps integers that would lose precision through JSON.parse as strings.
function preserveIntegers(text) {
  return String(text || "").replace(
    /:\s*(-?\d{16,})(?=[,}\]])/g,
    function (whole, digits) { return ":\"" + digits + "\""; },
  );
}

function dramaId(sourceId) {
  return sourceName + ":" + sourceId;
}

function chapterId(sourceId, key) {
  return sourceName + ":" + sourceId + ":" + key;
}

function truncate(text, limit) {
  const trimmed = text.trim();
  const characters = Array.from(trimmed);
  return characters.length <= limit ? trimmed : characters.slice(0, limit).join("") + "...";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function present(value) {
  return value !== undefined && value !== null;
}

function byteLength(text) {
  return utf8Encode(text).length;
}

function mapString(row, ...keys) {
  if (!isRecord(row)) {
    return "";
  }
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        return trimmed;
      }
    } else if (typeof value === "boolean" || typeof value === "number") {
      return String(value);
    }
  }
  return "";
}

function nativeText(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = nativeText(entry);
      if (text !== "") {
        return text;
      }
    }
  } else if (isRecord(value)) {
    for (const key of ["url", "src", "cover", "image", "pic"]) {
      const text = nativeText(value[key]);
      if (text !== "") {
        return text;
      }
    }
  }
  return "";
}

function integer(value, maximum) {
  const text = nativeText(value);
  if (!/^[+-]?\d+$/.test(text)) {
    return null;
  }
  const number = parseInt(text, 10);
  return number >= 0 && number <= maximum ? number : null;
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

function resolveUrlLocal(base, ref) {
  ref = String(ref || "").trim();
  if (ref === "") return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(ref)) return ref;
  if (ref.startsWith("//")) return "https:" + ref;
  const baseAddress = parseAddress(base);
  if (!baseAddress || baseAddress.scheme === "") return ref;
  const originText = baseAddress.scheme + "://" + baseAddress.host;
  if (ref.startsWith("/")) return originText + ref;
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

function origin(parsed) {
  const scheme = parsed.scheme.toLowerCase();
  let address = parsed.host.toLowerCase();
  if ((scheme === "https" && parsed.port === "443") || (scheme === "http" && parsed.port === "80")) {
    address = address.slice(0, address.length - parsed.port.length - 1);
  }
  return scheme + "://" + address;
}

function pathEscape(text) {
  const kept = { "%24": "$", "%26": "&", "%2B": "+", "%2C": ",", "%3A": ":", "%3B": ";", "%3D": "=", "%40": "@" };
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%(?:24|26|2B|2C|3A|3B|3D|40)/g, (escaped) => kept[escaped]);
}

function queryEscape(text) {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

function encodeQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => queryEscape(key) + "=" + queryEscape(String(params[key])))
    .join("&");
}

function validId(value) {
  return (
    value !== "" &&
    byteLength(value) <= 450 &&
    value.trim() === value &&
    value !== "." &&
    value !== ".." &&
    !/[/\\:?#%|"<>]/.test(value) &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function validCategory(category) {
  if (category === "") {
    return true;
  }
  if (byteLength(category) > 128 || /[|/\\\x00\r\n]/.test(category)) {
    return false;
  }
  return category === newestCategory || (validId(category) && !category.startsWith("@"));
}

function guestExpired() {
  const error = new Error("剧果访客授权已失效，请重试");
  error.guestExpired = true;
  return error;
}

function newDeviceId() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = hexEncode(bytes);
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}

async function request(method, route, query, body, token, retryAuth, limit) {
  let address = apiBaseUrl + route;
  if (query && Object.keys(query).length > 0) {
    address += "?" + encodeQuery(query);
  }
  const headers = {
    "User-Agent": userAgent,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: siteBaseUrl + "/",
    Origin: siteBaseUrl,
  };
  if (body !== "") {
    headers["Content-Type"] = "application/json";
  }
  if (token !== "") {
    headers.Authorization = "Bearer " + token;
  }
  const client = new Client({ 'useDartHttpClient': true });
  let response;
  if (method === "POST") {
    // The app encodes a Map itself when the request is JSON; handing it the
    // already-serialised string would encode it a second time.
    response = await client.post(address, headers, body === "" ? null : JSON.parse(body));
  } else {
    response = await client.get(address, headers);
  }
  if (response.statusCode === 401 || response.statusCode === 403) {
    throw guestExpired();
  }
  let value;
  try {
    value = JSON.parse(preserveIntegers(response.body));
  } catch (error) {
    throw new Error("剧果返回的数据格式无效");
  }
  return { value: value, headers: response.headers || {} };
}

function validToken(token) {
  return typeof token === "string" && token !== "" && byteLength(token) <= 8192 && !/[\u0000-\u0020\u007f-\uffff]/.test(token);
}

async function guestToken() {
  const cached = cacheGet(tokenKey);
  if (cached !== null) {
    return cached;
  }
  return await exclusive(async () => {
    const current = cacheGet(tokenKey);
    if (current !== null) {
      return current;
    }
    let deviceId = cacheGet(deviceKey);
    if (deviceId === null) {
      deviceId = newDeviceId();
      cacheSet(deviceKey, deviceId, 0);
    }
    const response = await request("POST", "/auth/guest", null, JSON.stringify({ deviceId }), "", false, 64 << 10);
    const row = isRecord(response.value) ? response.value : {};
    let token = typeof row.token === "string" ? row.token : "";
    if (token === "" && isRecord(row.data) && typeof row.data.token === "string") {
      token = row.data.token;
    }
    if (!validToken(token)) {
      throw new Error("剧果未返回有效的访客授权");
    }
    cacheSet(tokenKey, token, 0);
    return token;
  });
}

async function apiGet(route, query, limit) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await guestToken();
    try {
      return await request("GET", route, query, "", token, attempt === 0, limit);
    } catch (error) {
      if (attempt === 0 && error.guestExpired) {
        if (cacheGet(tokenKey) === token) {
          cacheSet(tokenKey, null, 0);
        }
        continue;
      }
      throw error;
    }
  }
  throw guestExpired();
}

function payload(value) {
  if (isRecord(value) && present(value.data) && !present(value.id) && !present(value.items) && !present(value.url)) {
    return value.data;
  }
  return value;
}

function categoryNames(row) {
  const names = [];
  const add = (value) => {
    let name = "";
    if (isRecord(value)) {
      name = typeof value.name === "string" ? value.name : "";
    } else if (typeof value === "string") {
      name = value;
    }
    name = name.trim();
    if (name !== "" && Array.from(name).length <= 48 && !names.includes(name) && names.length < 24) {
      names.push(name);
    }
  };
  add(row.category);
  if (Array.isArray(row.categories)) {
    row.categories.forEach(add);
  }
  return names;
}

function dramaFromRow(row, sourceId) {
  row = isRecord(row) ? row : {};
  const id = mapString(row, "id");
  const slug = mapString(row, "slug");
  const title = typeof row.title === "string" ? row.title : "";
  if (!validId(id) || title.trim() === "") {
    throw new Error("剧果返回的剧集信息不完整");
  }
  if (sourceId === "") {
    if (!validId(slug)) {
      throw new Error("剧果返回的剧集地址无效");
    }
    sourceId = slug + "-" + id;
  }
  if (!validId(sourceId) || !sourceId.endsWith("-" + id)) {
    throw new Error("剧果详情与请求剧集不符");
  }
  let episodes = 0;
  if (present(row.totalEpisodes)) {
    episodes = integer(row.totalEpisodes, 100000);
    if (episodes === null) {
      throw new Error("剧果集数格式无效");
    }
  }
  const categories = categoryNames(row);
  const tags = categories.slice();
  const region = mapString(row, "region");
  if (region !== "") {
    tags.push(truncate(region, 48));
  }
  const year = integer(row.year, 9999);
  if (year !== null && year >= 1000) {
    tags.push(year + "年");
  }
  let status = mapString(row, "status");
  if (status === "completed") {
    status = "finished";
  }
  if (status !== "finished" && status !== "ongoing") {
    status = "";
  }
  const description = typeof row.description === "string" ? row.description : "";
  const cover = coverAddress(row.coverUrl, siteBaseUrl + "/");
  return {
    id: dramaId(sourceId),
    source: sourceName,
    sourceId,
    title: truncate(title, 256),
    name: truncate(title, 256),
    desc: truncate(description, 12000),
    intro: truncate(description, 12000),
    cover,
    coverUrl: cover,
    totalEpisode: episodes,
    episodeCount: episodes,
    category: categories.length > 0 ? categories[0] : "短剧",
    channelName: channel,
    tags,
    releaseStatus: status,
    score: mapString(row, "score"),
  };
}

async function fetchCatalogPage(page, category, query) {
  if (page < 1 || page > 1000000 || byteLength(query) > 1024 || !validCategory(category)) {
    throw new Error("剧果目录查询参数无效");
  }
  const values = { page: String(page) };
  if (query !== "") {
    values.q = query;
  } else if (category === newestCategory) {
    values.sort = "new";
  } else if (category === "") {
    values.sort = "hot";
  } else {
    values.category = category;
  }
  const response = await apiGet("/dramas", values, 4 << 20);
  const row = payload(response.value);
  const rows = isRecord(row) ? row.items : undefined;
  if (!Array.isArray(rows) || rows.length > 500) {
    throw new Error("剧果目录数据格式无效");
  }
  let pageSize = 20;
  if (present(row.pageSize)) {
    pageSize = integer(row.pageSize, 500);
    if (pageSize === null || pageSize < 1) {
      throw new Error("剧果分页数据格式无效");
    }
  }
  if (present(row.page) && integer(row.page, 1000000) !== page) {
    throw new Error("剧果返回的页码与请求不符");
  }
  if (rows.length > pageSize) {
    throw new Error("剧果分页数据格式无效");
  }
  let hasMore = rows.length >= pageSize;
  if (present(row.total)) {
    const total = integer(row.total, 100000000);
    if (total === null || total < rows.length) {
      throw new Error("剧果分页总数无效");
    }
    hasMore = page < Math.floor((total + pageSize - 1) / pageSize);
  }
  if (hasMore && rows.length === 0) {
    throw new Error("剧果未返回应有的目录页，请重试");
  }
  const items = [];
  const seen = new Set();
  for (const entry of rows) {
    const drama = dramaFromRow(entry, "");
    if (seen.has(drama.id)) {
      throw new Error("剧果目录包含重复剧集，请重试");
    }
    seen.add(drama.id);
    items.push(drama);
  }
  return { items, hasMore };
}

function parseExpiration(value) {
  const text = nativeText(value);
  if (/^[+-]?\d+$/.test(text)) {
    const stamp = Number(text);
    if (stamp > 0 && stamp <= 253402300799000) {
      return stamp > 100000000000 ? stamp : stamp * 1000;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const parsed = Date.parse(text.replace(/(\.\d{3})\d+/, "$1"));
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function cookieExpires(value) {
  const match = value.match(/^[A-Z][a-z]{2}, (\d{2})[ -]([A-Z][a-z]{2})[ -](\d{4}) (\d{2}):(\d{2}):(\d{2}) [A-Z]+$/);
  if (!match || !Object.prototype.hasOwnProperty.call(months, match[2])) {
    return null;
  }
  return Date.UTC(parseInt(match[3], 10), months[match[2]], parseInt(match[1], 10), parseInt(match[4], 10), parseInt(match[5], 10), parseInt(match[6], 10));
}

function cookieValue(raw) {
  if (raw.length > 1 && raw[0] === '"' && raw[raw.length - 1] === '"') {
    raw = raw.slice(1, -1);
  }
  return /^[\u0020\u0021\u0023-\u002b\u002d-\u003a\u003c-\u005b\u005d-\u007e]*$/.test(raw) ? raw : null;
}

function parseSetCookie(line) {
  const parts = line.trim().split(";");
  if (parts.length === 1 && parts[0] === "") {
    return null;
  }
  const first = parts[0].trim();
  const separator = first.indexOf("=");
  if (separator < 0) {
    return null;
  }
  const name = first.slice(0, separator).trim();
  const value = cookieValue(first.slice(separator + 1));
  if (name === "" || value === null) {
    return null;
  }
  const cookie = { name, value, expires: null, maxAge: 0 };
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index].trim();
    if (part === "") {
      continue;
    }
    const cut = part.indexOf("=");
    const attribute = (cut < 0 ? part : part.slice(0, cut)).toLowerCase();
    const raw = cookieValue(cut < 0 ? "" : part.slice(cut + 1));
    if (raw === null) {
      continue;
    }
    if (attribute === "max-age") {
      if (!/^[+-]?\d+$/.test(raw) || (raw !== "0" && raw[0] === "0")) {
        continue;
      }
      const seconds = parseInt(raw, 10);
      cookie.maxAge = seconds <= 0 ? -1 : seconds;
    } else if (attribute === "expires") {
      cookie.expires = cookieExpires(raw);
    }
  }
  return cookie;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (headers[name] !== undefined) return headers[name];
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

function mediaCredentials(headers, address, expiration) {
  // The app joins repeated headers into one string; a cookie jar has to see
  // them one per line, so split on the commas that start a new cookie.
  const raw = headerValue(headers, "Set-Cookie");
  const lines = Array.isArray(raw)
    ? raw
    : (typeof raw === "string" && raw !== "" ? raw.split(/,(?=\s*[A-Za-z0-9_\-]+=)/) : []);
  const cookies = {};
  let expires = parseExpiration(expiration);
  const remember = (value) => {
    if (value !== null && (expires === null || value < expires)) {
      expires = value;
    }
  };
  for (const line of lines) {
    const cookie = parseSetCookie(line);
    if (cookie && signedCookieNames.includes(cookie.name)) {
      cookies[cookie.name] = cookie.value;
      remember(cookie.expires);
      if (cookie.maxAge !== 0) {
        remember(Date.now() + Math.min(cookie.maxAge, 86400 * 365) * 1000);
      }
    }
  }
  for (const line of lines) {
    let count = 0;
    for (const match of line.matchAll(signedCookiePattern)) {
      if (++count > 12) {
        break;
      }
      cookies["CloudFront-" + match[1]] = match[2];
    }
  }
  const values = [];
  for (const name of signedCookieNames) {
    const value = cookies[name] || "";
    if (value === "" || byteLength(value) > 8192 || /[,;"\\]/.test(value) || /[\u0000-\u0020\u007f-\uffff]/.test(value)) {
      throw new Error("剧果未返回完整的媒体凭证，请重试");
    }
    values.push(name + "=" + value);
  }
  if (expires !== null && Date.now() >= expires) {
    throw new Error("剧果返回的媒体凭证已过期，请重试；反复出现时请检查设备时间");
  }
  const parsed = parseAddress(address);
  if (!parsed || !httpAddress(address)) {
    throw new Error("剧果播放地址无效");
  }
  return {
    cookie: values.join("; "),
    origin: origin(parsed),
    referer: siteBaseUrl + "/",
    userAgent,
    expiresMs: expires === null ? 0 : expires,
  };
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

    /// Read once per session; the filter sheet needs it synchronously.
    async loadCategories() {
        if (this._categories != null) return this._categories;
        const all = await this.getCategories();
        // The api hands back every tag it knows, hundreds of them; a picker
        // that long is unusable, so keep the ones the site lists first and
        // drop duplicates by name.
        const seen = new Set([""]);
        const kept = [{ id: "", name: "全部" }];
        for (const entry of all) {
            const name = String(entry.name || "").trim();
            if (name === "" || seen.has(name)) continue;
            seen.add(name);
            kept.push(entry);
            if (kept.length >= 60) break;
        }
        this._categories = kept;
        return kept;
    }

    async getCategories() {
        const rows = payload((await apiGet("/categories", null, 256 << 10)).value);
        if (!Array.isArray(rows) || rows.length > 1000) throw new Error("剧果分类数据格式无效");
        const categories = [{ id: newestCategory, name: "最新" }];
        const seen = new Set([newestCategory]);
        for (const entry of rows) {
            const id = mapString(entry, "slug");
            const name = mapString(entry, "name");
            if (id === "hot") continue;
            if (!validCategory(id) || id === "" || name === "" ||
                Array.from(name).length > 48 || seen.has(id)) continue;
            seen.add(id);
            categories.push({ id: id, name: name });
        }
        return categories;
    }

    toList(items) {
        return items.map((item) => ({
            name: item.title || item.name || "",
            link: item.sourceId || "",
            imageUrl: item.cover || "",
            description: item.desc || item.intro || "",
        }));
    }

    async getPopular(page) {
        await this.loadCategories();
        const result = await fetchCatalogPage(page, "", "");
        return { list: this.toList(result.items), hasNextPage: result.hasMore };
    }

    async getLatestUpdates(page) {
        await this.loadCategories();
        const result = await fetchCatalogPage(page, newestCategory, "");
        return { list: this.toList(result.items), hasNextPage: result.hasMore };
    }

    async search(query, page, filters) {
        await this.loadCategories();
        const keyword = String(query || "").trim();
        // With no keyword the filter sheet drives it: a category pick browses
        // that category, no pick browses what is popular.
        const category = keyword === "" ? categoryOf(filters) : "";
        const result = await fetchCatalogPage(page, category, keyword);
        return { list: this.toList(result.items), hasNextPage: result.hasMore };
    }

    async getDetail(url) {
        const sourceId = String(url || "").trim();
        if (!validId(sourceId)) throw new Error("剧果剧集地址无效");
        const row = payload((await apiGet("/dramas/" + pathEscape(sourceId), null, 8 << 20)).value);
        const drama = dramaFromRow(row, sourceId);
        const rows = row.episodes;
        if (!Array.isArray(rows) || rows.length > 10000) throw new Error("剧果分集目录格式无效");

        const chapters = [];
        const seenIds = new Set();
        const seenNumbers = new Set();
        rows.forEach((entry, index) => {
            const episode = isRecord(entry) ? entry : {};
            if (episode.playable === false) return;
            const id = mapString(episode, "id");
            if (!validId(id) || seenIds.has(id)) return;
            let number = index + 1;
            if (present(episode.epNo)) {
                const parsed = integer(episode.epNo, 100000);
                if (parsed !== null && parsed > 0) number = parsed;
            }
            if (seenNumbers.has(number)) return;
            seenIds.add(id);
            seenNumbers.add(number);
            chapters.push({
                name: "第 " + number + " 集",
                url: sourceId + "|" + id,
                episode: number,
            });
        });
        chapters.sort((left, right) => left.episode - right.episode);

        return {
            name: drama.title || drama.name || "",
            imageUrl: drama.cover || "",
            description: drama.intro || drama.desc || "",
            genre: drama.tags || [],
            author: drama.channelName || "",
            status: drama.releaseStatus === "finished" ? 1 : 0,
            chapters: chapters,
        };
    }

    async getVideoList(url) {
        const parts = String(url || "").split("|");
        if (parts.length !== 2) throw new Error("剧果播放分集信息无效，请刷新详情");
        const episodeId = parts[1];
        if (!validId(episodeId)) throw new Error("剧果分集地址无效");

        const response = await apiGet("/play/" + pathEscape(episodeId), null, 64 << 10);
        const row = payload(response.value);
        const address = isRecord(row) && typeof row.url === "string" ? row.url : "";
        const credentials = mediaCredentials(response.headers, address, isRecord(row) ? row.expiresAt : undefined);

        const headers = {
            "Referer": credentials.referer,
            "User-Agent": credentials.userAgent,
            "Cookie": credentials.cookie,
        };

        const parsed = parseAddress(address);
        const isPlaylist = parsed && parsed.path.toLowerCase().endsWith(".m3u8");
        let finalUrl = address;
        if (isPlaylist) {
            // The playlist and every segment behind it need the signed cookies,
            // so route it through the app's HLS proxy.
            try {
                finalUrl = await createHlsProxyUrl(address, headers);
            } catch (error) {
                finalUrl = address;
            }
        }

        return [{
            url: finalUrl,
            originalUrl: address,
            quality: "Origin",
            headers: headers,
        }];
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
