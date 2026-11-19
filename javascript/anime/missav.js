const mangayomiSources = [{
    "name": "MissAV",
    "lang": "zh",
    "baseUrl": "https://missav.live",
    "apiUrl": "",
    "iconUrl": "https://missav.live/favicon.ico",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "version": "0.0.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "hasCloudflare": true
}];

// Converted from the guoapp module "missav" (module.exports + host.*) to the
// Mangayomi MProvider shape. The selection logic is the original one; only the
// transport changed: host.fetchText() became await Client().get(), and the
// plain node tree became Document/Element selectors.
class DefaultExtension extends MProvider {
    get baseUrl() {
        return this.source.baseUrl;
    }

    header(referer) {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            "Referer": referer || this.baseUrl + "/"
        };
    }

    // The site serves its catalogue under a rotating /dm<number>/ prefix and
    // 301s the bare /cn/ path there. Client follows redirects, which is why
    // every request here just uses the clean path.
    async fetchBody(url) {
        const res = await new Client({ 'useDartHttpClient': true }).get(url, this.header());
        return res.body;
    }

    text(el) {
        if (!el) return "";
        return (el.text || "").replace(/\s+/g, " ").trim();
    }

    attr(el, name) {
        if (!el) return "";
        return el.attr(name) || "";
    }

    absolute(raw) {
        raw = (raw || "").trim();
        if (raw === "" || raw.startsWith("data:")) return "";
        if (raw.startsWith("//")) return "https:" + raw;
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
        if (raw.startsWith("/")) return this.baseUrl + raw;
        return this.baseUrl + "/" + raw;
    }

    // /cn/<slug> or /dm<n>/cn/<slug>
    slugOf(href) {
        const m = /\/(?:dm[0-9]+\/)?cn\/([a-z0-9][a-z0-9._-]{0,127})\/?$/.exec(href || "");
        return m ? m[1] : "";
    }

    genreOf(href) {
        const m = /\/(?:dm[0-9]+\/)?cn\/genres\/([^/?#]+)\/?$/.exec(href || "");
        return m ? m[1] : "";
    }

    validCategory(category) {
        if (category === "" || category == null) return true;
        return category.length <= 96 && !/[/\\?#\x00\r\n]/.test(category);
    }

    async categories() {
        const doc = new Document(await this.fetchBody(this.baseUrl + "/cn/genres"));
        const order = [];
        const names = {};
        for (const anchor of doc.select("a")) {
            const slug = this.genreOf(this.attr(anchor, "href"));
            if (slug === "" || !this.validCategory(slug)) continue;
            const name = this.text(anchor);
            if (name === "") continue;
            if (!Object.prototype.hasOwnProperty.call(names, slug)) {
                names[slug] = name;
                order.push(slug);
            } else if (name.length < names[slug].length) {
                names[slug] = name;
            }
        }
        return order.slice(0, 200).map((slug) => ({ id: slug, name: names[slug] }));
    }

    async fetchCatalogPage(page, category, query) {
        if (!Number.isInteger(page) || page < 1 || page > 1000000) {
            throw new Error("MissAV 页码无效");
        }
        let address = this.baseUrl + "/cn/new";
        if (query !== "") {
            address = this.baseUrl + "/cn/search/" + encodeURIComponent(query);
        } else if (category !== "") {
            address = this.baseUrl + "/cn/genres/" + encodeURIComponent(category);
        }
        const body = await this.fetchBody(address + "?page=" + page);
        const doc = new Document(body);
        const items = this.parseCards(doc);
        const hasMore = this.hasMorePages(doc, page);
        return { items, hasMore };
    }

    parseCards(doc) {
        const items = [];
        const seen = new Set();
        for (const card of doc.select("div.thumbnail")) {
            const cls = this.attr(card, "class").split(/\s+/);
            if (!cls.includes("group")) continue;
            if (items.length >= 500) break;

            let slug = "";
            for (const anchor of card.select("a")) {
                slug = this.slugOf(this.attr(anchor, "href"));
                if (slug !== "") break;
            }
            if (slug === "" || seen.has(slug)) continue;

            // Prefer data-src: the site ships a placeholder in src.
            let image = null;
            let fallback = null;
            for (const img of card.select("img")) {
                const dataSrc = this.attr(img, "data-src");
                if (dataSrc !== "" && !dataSrc.startsWith("data:")) {
                    image = img;
                    break;
                }
                if (fallback === null) {
                    const plain = this.attr(img, "src");
                    if (plain !== "" && !plain.startsWith("data:")) fallback = img;
                }
            }
            if (image === null) image = fallback;

            let title = this.text(card.selectFirst("div.my-2"));
            if (title === "" && image !== null) title = this.attr(image, "alt").trim();
            if (title === "") title = slug.toUpperCase();

            const cover = image === null
                ? ""
                : this.absolute(this.attr(image, "data-src") || this.attr(image, "src"));

            seen.add(slug);
            items.push({
                name: title,
                imageUrl: cover,
                link: slug
            });
        }
        return items;
    }

    hasMorePages(doc, page) {
        let maxPage = 0;
        for (const anchor of doc.select("a")) {
            const m = /[?&]page=([0-9]{1,7})/.exec(this.attr(anchor, "href"));
            if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
        }
        return maxPage > page;
    }

    categoryOf(filterList) {
        for (const f of filterList || []) {
            if (f && f.type === "categories" && f.values && f.values.length) {
                const state = typeof f.state === "number" ? f.state : 0;
                const pick = f.values[state] || f.values[0];
                return pick ? String(pick.value || "") : "";
            }
        }
        return "";
    }

    async getPopular(page) {
        const r = await this.fetchCatalogPage(page, "", "");
        return { list: r.items, hasNextPage: r.hasMore };
    }

    async getLatestUpdates(page) {
        const r = await this.fetchCatalogPage(page, "", "");
        return { list: r.items, hasNextPage: r.hasMore };
    }

    async search(query, page, filters) {
        query = (query || "").trim();
        if (query === "") return { list: [], hasNextPage: false };
        if (query.length > 256) throw new Error("MissAV 搜索词过长");
        const r = await this.fetchCatalogPage(page, "", query);
        return { list: r.items, hasNextPage: r.hasMore };
    }

    metadataOf(doc) {
        const out = {};
        for (const node of doc.select("meta")) {
            const key = this.attr(node, "property") || this.attr(node, "name");
            const value = this.attr(node, "content").trim();
            if (key !== "" && value !== "" && !out[key]) out[key] = value;
        }
        return out;
    }

    async getDetail(url) {
        const slug = String(url || "").trim();
        if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(slug)) {
            throw new Error("MissAV 视频 ID 无效");
        }
        const pageUrl = this.baseUrl + "/cn/" + slug;
        const body = await this.fetchBody(pageUrl);
        const doc = new Document(body);
        const meta = this.metadataOf(doc);

        const genres = [];
        for (const anchor of doc.select("a")) {
            const g = this.genreOf(this.attr(anchor, "href"));
            if (g === "") continue;
            const name = this.text(anchor);
            if (name !== "" && !genres.includes(name)) genres.push(name);
        }

        let title = (meta["og:title"] || "").trim();
        if (title === "") {
            for (const h of doc.select("h1")) {
                const t = this.text(h);
                if (t !== "") { title = t; break; }
            }
        }
        if (title === "") title = slug.toUpperCase();

        let cover = (meta["og:image"] || "").trim();
        if (cover === "") {
            for (const img of doc.select("video")) {
                cover = this.attr(img, "poster");
                if (cover !== "") break;
            }
        }

        return {
            name: title,
            imageUrl: this.absolute(cover),
            description: (meta["og:description"] || "").trim(),
            genre: genres,
            author: "",
            status: 0,
            link: pageUrl,
            chapters: [{
                name: "正片",
                url: pageUrl
            }]
        };
    }

    async getVideoList(url) {
        const pageUrl = String(url || "").trim();
        const body = await this.fetchBody(pageUrl);
        // The player address sits in the page as an m3u8 on surrit.com, either
        // plainly or inside a packed eval() blob.
        const pattern = /https?:\/\/surrit\.com\/[0-9a-f-]{36}\/playlist\.m3u8/;
        let address = "";
        const direct = body.match(pattern);
        if (direct) {
            address = direct[0];
        } else {
            const packed = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('((?:[^'\\]|\\.)*)',([0-9]+),([0-9]+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)/gs;
            for (const m of body.matchAll(packed)) {
                const found = unpackJs(m[0]).match(pattern);
                if (found) { address = found[0]; break; }
            }
        }
        if (address === "") {
            throw new Error("MissAV 页面里未解析到播放地址");
        }
        return [{
            url: address,
            originalUrl: address,
            quality: "Origin",
            headers: { "Referer": pageUrl }
        }];
    }

    getHeaders(url) {
        return this.header();
    }

    getFilterList() {
        return { filters: [] };
    }

    getSourcePreferences() {
        return [];
    }
}
