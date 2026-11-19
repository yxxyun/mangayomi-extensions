const mangayomiSources = [{
    "name": "黑桃",
    "lang": "zh",
    "baseUrl": "https://heitaodj.com",
    "apiUrl": "",
    "iconUrl": "https://heitaodj.com/favicon.ico",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "version": "0.0.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "hasCloudflare": false
}];

// Ported from the guoapp module "heitao" (module.exports + global `host`) to
// the Mangayomi MProvider shape.
//
// The selection and parsing logic is the original one. What changed:
//
//   1. host.fetchText() was synchronous there and Client is asynchronous here,
//      so the functions that fetch are async and await.
//   2. The node tree it walks, and the utf8/base64 helpers it used, now come
//      from the runtime itself (parseHtmlTree, htmlNodes, htmlAttr, htmlClass,
//      htmlText, tagged, utf8Encode, utf8Decode, base64Decode) instead of a
//      copy per source.
//   3. A chapter carries a URL rather than an id, so the player needs
//      (dramaId, sid, nid) travel together in the chapter url.

const siteBaseUrl = "https://heitaodj.com";
const userAgent = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const ageCookie = "heitao_age_confirmed=1";

const numericIdPattern = /^[1-9][0-9]{0,17}$/;
const episodeHrefPattern = /\/index\.php\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/i;
const episodeCountPattern = /^(\d+)集$/;
const searchPagePattern = /\/vod\/search\/page\/(\d+)\/wd\//i;

// ── URL helpers (the runtime has no URL class) ──────────────────────────────

function parseAddress(raw) {
    const text = String(raw || "").trim();
    const match = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/([^\/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(text);
    if (!match) {
        return text === ""
            ? null
            : { scheme: "", host: "", hostname: "", port: "", path: text, query: "", fragment: "", userInfo: "", href: text };
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
    ref = decodeHtmlEntities(String(ref || "")).trim();
    if (ref === "") return "";
    ref = ref.replace(/\\\//g, "/");
    if (ref.startsWith("//")) return "https:" + ref;
    const direct = parseAddress(ref);
    if (direct && direct.scheme !== "") return direct.href;
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
    return parsed !== null && (parsed.scheme === "http" || parsed.scheme === "https") &&
        parsed.hostname !== "" && !parsed.userInfo;
}

function originOf(parsed) {
    const scheme = parsed.scheme.toLowerCase();
    let address = parsed.host.toLowerCase();
    if ((scheme === "https" && parsed.port === "443") || (scheme === "http" && parsed.port === "80")) {
        address = address.slice(0, address.length - parsed.port.length - 1);
    }
    return scheme + "://" + address;
}

// ── Module helpers ─────────────────────────────────────────────────────────

function truncate(text, limit) {
    const trimmed = String(text || "").trim();
    const characters = Array.from(trimmed);
    return characters.length <= limit ? trimmed : characters.slice(0, limit).join("") + "...";
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseInteger(text) {
    return /^[+-]?\d+$/.test(text) ? parseInt(text, 10) : NaN;
}

function coverAddress(value, pageUrl) {
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = coverAddress(entry, pageUrl);
            if (found !== "") return found;
        }
    } else if (isRecord(value)) {
        for (const key of ["url", "contentUrl", "thumbnailUrl"]) {
            const found = coverAddress(value[key], pageUrl);
            if (found !== "") return found;
        }
    } else if (typeof value === "string" && value.trim() !== "") {
        const resolved = resolveUrlLocal(pageUrl, value.trim());
        if (httpAddress(resolved)) return resolved;
    }
    return "";
}

function pathEscape(text) {
    const kept = { "%24": "$", "%26": "&", "%2B": "+", "%2C": ",", "%3A": ":", "%3B": ";", "%3D": "=", "%40": "@" };
    return encodeURIComponent(text)
        .replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase())
        .replace(/%(?:24|26|2B|2C|3A|3B|3D|40)/g, (escaped) => kept[escaped]);
}

function percentDecode(text, plusIsSpace) {
    if (/%(?![0-9a-fA-F]{2})/.test(text)) return null;
    const bytes = [];
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === "%") {
            bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
            index += 2;
        } else if (plusIsSpace && character === "+") {
            bytes.push(32);
        } else {
            for (const byte of utf8Encode(character)) bytes.push(byte);
        }
    }
    return utf8Decode(bytes);
}

function queryParameters(query) {
    const values = {};
    for (const part of query.split("&")) {
        if (part === "" || part.indexOf(";") !== -1) continue;
        const separator = part.indexOf("=");
        const key = percentDecode(separator < 0 ? part : part.slice(0, separator), true);
        const value = percentDecode(separator < 0 ? "" : part.slice(separator + 1), true);
        if (key === null || value === null) continue;
        (values[key] = values[key] || []).push(value);
    }
    return values;
}

function routeParameters(pageUrl, reference) {
    const page = parseAddress(pageUrl);
    if (!page || reference === "") return null;
    const address = parseAddress(resolveUrlLocal(pageUrl, reference));
    if (!address || address.userInfo || originOf(address) !== originOf(page)) return null;
    let path = address.path.startsWith("/index.php") ? address.path.slice("/index.php".length) : address.path;
    if (path.endsWith(".html")) path = path.slice(0, -5);
    const parts = path.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2 || parts[0] !== "vod" || parts.length % 2 !== 0) return null;
    if (["type", "show", "search", "play", "detail"].indexOf(parts[1]) === -1) return null;
    const values = {};
    for (let index = 2; index + 1 < parts.length; index += 2) {
        values[parts[index]] = parts[index + 1];
    }
    const query = queryParameters(address.query);
    for (const key of Object.keys(query)) {
        if (query[key].length === 1 && !values[key]) values[key] = query[key][0];
    }
    return { action: parts[1], values: values };
}

function scriptText(node) {
    return (node.children || [])
        .filter((child) => child.tag === undefined)
        .map((child) => child.text)
        .join("")
        .trim();
}

function seriesShaped(value) {
    return value === null || (isRecord(value) && ["@type", "name", "description"].every(
        (key) => value[key] === undefined || value[key] === null || typeof value[key] === "string"));
}

function isSeries(value) {
    return typeof value["@type"] === "string" && value["@type"].toLowerCase() === "tvseries";
}

function seriesMetadata(document) {
    for (const script of htmlNodes(document, (node) => node.tag === "script" &&
        htmlAttr(node, "type").toLowerCase().indexOf("ld+json") !== -1)) {
        const text = scriptText(script);
        if (text === "") continue;
        let value;
        try {
            value = JSON.parse(text);
        } catch (error) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                if (seriesShaped(entry) && isSeries(entry || {})) return entry || {};
            }
        } else if (seriesShaped(value) && isSeries(value || {})) {
            return value || {};
        }
    }
    return {};
}

function validCategory(category) {
    return category === "" || (category.length <= 6 && numericIdPattern.test(category));
}

function categoryName(document) {
    for (const node of htmlNodes(document, tagged("li"))) {
        const text = htmlText(node).trim();
        if (text.startsWith("分类：")) {
            const name = text.slice("分类：".length).trim();
            if (name !== "") return name;
        }
    }
    return "";
}

function tagsOf(document) {
    const block = htmlFirstClass(document, "detail-tags");
    const tags = [];
    for (const anchor of htmlNodes(block, tagged("a"))) {
        const value = htmlText(anchor).trim();
        if (value === "" || Array.from(value).length > 48 || tags.indexOf(value) !== -1) continue;
        tags.push(value);
        if (tags.length >= 32) break;
    }
    return tags;
}

function episodeCount(remark) {
    const match = remark.trim().match(episodeCountPattern);
    if (!match) return 0;
    const value = parseInt(match[1], 10);
    return value >= 1 && value <= 100000 ? value : 0;
}

function parseCards(document, pageUrl) {
    const items = [];
    const seen = new Set();
    for (const card of htmlNodes(document, (node) => node.tag === "a" && htmlClass(node, "thumb"))) {
        const route = routeParameters(pageUrl, htmlAttr(card, "href"));
        const id = route ? route.values.id || "" : "";
        if (!route || route.action !== "detail" || !numericIdPattern.test(id) || seen.has(id)) continue;
        const images = htmlNodes(card, tagged("img"));
        let title = htmlAttr(card, "title").trim();
        for (const image of images) {
            if (title === "") title = htmlAttr(image, "alt").trim();
            if (title !== "") break;
        }
        if (title === "") title = htmlText(card).trim();
        if (title === "") continue;
        seen.add(id);
        let cover = "";
        for (const image of images) {
            for (const attribute of ["src", "data-src", "data-original"]) {
                cover = coverAddress(htmlAttr(image, attribute), pageUrl);
                if (cover !== "") break;
            }
            if (cover !== "") break;
        }
        const label = htmlFirstClass(card, "label");
        const remark = label ? truncate(htmlText(label), 64) : "";
        items.push({
            name: truncate(title, 512),
            imageUrl: cover,
            link: id,
            description: remark,
        });
        if (items.length >= 500) break;
    }
    return items;
}

function pageCount(document, pageUrl, category, query, page) {
    let pages = page;
    for (const anchor of htmlNodes(document, tagged("a"))) {
        const href = htmlAttr(anchor, "href");
        let value = "";
        if (query !== "") {
            const match = href.match(searchPagePattern);
            if (match) value = match[1];
        } else {
            const route = routeParameters(pageUrl, href);
            if (route && (route.action === "show" || route.action === "type") &&
                (route.values.id || "") === category) {
                value = route.values.page || "";
            }
        }
        const number = parseInteger(value);
        if (number > pages && number < 100000) pages = number;
    }
    return pages;
}

function catalogAddress(page, category, query) {
    if (query !== "") {
        const escaped = pathEscape(query);
        return page <= 1
            ? siteBaseUrl + "/index.php/vod/search/wd/" + escaped + ".html"
            : siteBaseUrl + "/index.php/vod/search/page/" + page + "/wd/" + escaped + ".html";
    }
    let show = siteBaseUrl + "/index.php/vod/show";
    if (category !== "") show += "/id/" + category;
    return page <= 1 ? show + ".html" : show + "/page/" + page + ".html";
}

function chaptersOf(document, sourceId) {
    const groups = new Map();
    const seen = new Set();
    for (const anchor of htmlNodes(document, tagged("a"))) {
        const match = htmlAttr(anchor, "href").match(episodeHrefPattern);
        if (!match || match[1] !== sourceId) continue;
        const sid = parseInt(match[2], 10);
        const nid = parseInt(match[3], 10);
        if (!(sid >= 1) || !(nid >= 1)) continue;
        const key = sid + ":" + nid;
        if (seen.has(key)) continue;
        seen.add(key);
        const title = htmlText(anchor).trim() || "第 " + nid + " 集";
        if (!groups.has(sid)) groups.set(sid, []);
        groups.get(sid).push({ sid: sid, nid: nid, title: title });
    }
    let best = [];
    let bestSid = 0;
    for (const [sid, items] of groups) {
        if (items.length > best.length || (items.length === best.length && sid < bestSid)) {
            best = items;
            bestSid = sid;
        }
    }
    return best.map((item) => ({
        name: truncate(item.title, 128),
        url: sourceId + "|" + item.sid + "|" + item.nid,
    })).sort((left, right) =>
        parseInt(left.url.split("|")[2], 10) - parseInt(right.url.split("|")[2], 10));
}

function readPlayerConfig(body) {
    const index = body.indexOf("player_aaaa");
    if (index < 0) throw new Error("黑桃播放器未返回配置");
    const text = body.slice(index);
    const open = text.indexOf("{");
    if (open < 0) throw new Error("黑桃播放器配置无效");
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let position = open; position < text.length && end < 0; position++) {
        const character = text[position];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') inString = true;
        else if (character === "{") depth++;
        else if (character === "}") {
            depth--;
            if (depth === 0) end = position;
        }
    }
    if (end < 0) throw new Error("黑桃播放器配置不完整");
    let entry;
    try {
        entry = JSON.parse(text.slice(open, end + 1));
    } catch (error) {
        throw new Error("黑桃播放器配置解析失败：" + error.message);
    }
    if (!isRecord(entry) || (entry.url !== undefined && entry.url !== null && typeof entry.url !== "string")) {
        throw new Error("黑桃播放器配置解析失败：播放地址格式无效");
    }
    if (typeof entry.url !== "string" || entry.url.trim() === "") {
        throw new Error("黑桃该集暂无可用播放地址");
    }
    return entry;
}

function encryptMode(value) {
    if (typeof value === "number") return Math.trunc(value);
    if (typeof value === "string") {
        const parsed = parseInteger(value.trim());
        return isNaN(parsed) ? 0 : parsed;
    }
    return value === true ? 1 : 0;
}

function decryptMediaUrl(raw, encrypt) {
    raw = String(raw || "").trim();
    if (encrypt === 0) return raw;
    if (encrypt !== 1 && encrypt !== 2) throw new Error("黑桃播放地址加密方式暂不支持");
    let text = raw;
    if (encrypt === 2) {
        try {
            text = utf8Decode(base64Decode(raw));
        } catch (error) {
            throw new Error("黑桃播放地址解码失败");
        }
    }
    const decoded = percentDecode(text, false);
    if (decoded === null) throw new Error("黑桃播放地址解码失败");
    return decoded;
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

    headers(referer) {
        return { "User-Agent": userAgent, "Referer": referer || siteBaseUrl + "/" };
    }

    async fetchPage(address, cookie) {
        const headers = this.headers();
        if (cookie) headers["Cookie"] = cookie;
        const res = await new Client({ 'useDartHttpClient': true }).get(address, headers);
        const finalUrl = (res.request && res.request.url) || address;
        return { document: parseHtmlTree(res.body), pageUrl: finalUrl };
    }

    async fetchCatalogPage(page, category, query) {
        query = String(query || "").trim();
        if (page < 1 || page > 100000 || query.length > 256 || !validCategory(category)) {
            throw new Error("黑桃目录查询参数无效");
        }
        const pageResult = await this.fetchPage(catalogAddress(page, category, query));
        return {
            list: parseCards(pageResult.document, pageResult.pageUrl),
            hasNextPage: pageCount(pageResult.document, pageResult.pageUrl, category, query, page) > page,
        };
    }

    async getPopular(page) {
        await this.loadCategories();
        return await this.fetchCatalogPage(page, "", "");
    }

    async getLatestUpdates(page) {
        await this.loadCategories();
        return await this.fetchCatalogPage(page, "", "");
    }

    async search(query, page, filters) {
        query = String(query || "").trim();
        // Browsing a category arrives here with an empty query and the
        // category picked in the filter sheet.
        await this.loadCategories();
        const category = query === "" ? categoryOf(filters) : "";
        return await this.fetchCatalogPage(page, category, query);
    }

    /// The site's content categories, read from its own navigation, cached for
    /// the session. The filter sheet itself is evaluated synchronously by the
    /// app, so it can only report what has been read already; the first load
    /// of the source fills this in.
    async loadCategories() {
        if (this._categories != null) return this._categories;
        if (this._categories != null) return this._categories;
        const list = [{ id: "", name: "全部" }];
        try {
            const result = await this.fetchPage(siteBaseUrl + "/");
            const seen = new Set();
            for (const anchor of htmlNodes(result.document, tagged("a"))) {
                const route = routeParameters(result.pageUrl, htmlAttr(anchor, "href"));
                const id = route ? route.values.id || "" : "";
                const name = htmlText(anchor).trim();
                if (!route || route.action !== "type" || !validCategory(id) || id === "") continue;
                if (name === "" || Array.from(name).length > 48 || seen.has(id)) continue;
                seen.add(id);
                list.push({ id: id, name: name });
            }
        } catch (error) {
            // A filter sheet without categories still browses; keep "全部".
        }
        this._categories = list;
        return list;
    }

    async getDetail(url) {
        const sourceId = String(url || "").trim();
        if (!numericIdPattern.test(sourceId)) throw new Error("黑桃视频 ID 无效");
        const result = await this.fetchPage(
            siteBaseUrl + "/index.php/vod/detail/id/" + sourceId + ".html");
        const document = result.document;
        const pageUrl = result.pageUrl;

        const meta = seriesMetadata(document);
        let name = typeof meta.name === "string" ? meta.name.trim() : "";
        if (name === "") {
            const heading = htmlFirstClass(document, "title");
            name = heading ? htmlText(heading).trim() : "";
        }
        if (name === "") throw new Error("黑桃详情缺少剧名");

        const chapters = chaptersOf(document, sourceId);
        if (chapters.length === 0) throw new Error("黑桃该剧暂无可播放分集");

        let cover = coverAddress(meta.image, pageUrl);
        if (cover === "") {
            for (const image of htmlNodes(htmlFirstClass(document, "albumDetailImg"), tagged("img"))) {
                cover = coverAddress(htmlAttr(image, "src"), pageUrl);
                if (cover !== "") break;
            }
        }

        return {
            name: truncate(name, 512),
            imageUrl: cover,
            description: truncate(typeof meta.description === "string" ? meta.description : "", 12000),
            genre: tagsOf(document),
            author: categoryName(document) || "短剧",
            status: 0,
            chapters: chapters,
        };
    }

    async getVideoList(url) {
        const parts = String(url || "").split("|");
        if (parts.length !== 3) throw new Error("黑桃播放分集信息无效，请刷新详情");
        const sourceId = parts[0];
        const sid = parseInteger(parts[1]);
        const nid = parseInteger(parts[2]);
        if (!numericIdPattern.test(sourceId) || !(sid >= 1) || !(nid >= 1)) {
            throw new Error("黑桃播放分集信息无效，请刷新详情");
        }

        const playerUrl = siteBaseUrl + "/index.php/vod/player/id/" + sourceId +
            "/nid/" + nid + "/sid/" + sid + ".html";
        const playUrl = siteBaseUrl + "/index.php/vod/play/id/" + sourceId +
            "/sid/" + sid + "/nid/" + nid + ".html";

        const headers = this.headers(playUrl);
        headers["Cookie"] = ageCookie;
        const res = await new Client({ 'useDartHttpClient': true }).get(playerUrl, headers);
        const entry = readPlayerConfig(res.body);
        const address = resolveUrlLocal(playerUrl, decryptMediaUrl(entry.url, encryptMode(entry.encrypt)));
        if (!httpAddress(address)) throw new Error("黑桃播放地址无效");

        return [{
            url: address,
            originalUrl: address,
            quality: "Origin",
            headers: { "Referer": siteBaseUrl + "/" },
        }];
    }

    getHeaders(url) {
        return this.headers();
    }

    getFilterList() {
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
