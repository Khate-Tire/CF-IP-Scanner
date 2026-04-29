/**
 * Cloudflare Worker — DB Proxy for Antigravity IP Scanner
 * Copyright (c) 2026 Khate Tire
 *
 * Uses Cloudflare Hyperdrive for direct MySQL access via edge network.
 * This makes the DB accessible through Cloudflare's infrastructure,
 * which is nearly impossible for ISPs to block.
 *
 * Hyperdrive binding: HYPERDRIVE (configured in wrangler.toml)
 * Env var: API_KEY (for request authentication)
 */

import mysql from "mysql2/promise";

const analyticsCache = new Map();

export default {
    async fetch(request, env, ctx) {
        // CORS preflight
        if (request.method === "OPTIONS") {
            return cors(new Response(null, { status: 204 }));
        }

        const url = new URL(request.url);
        const path = url.pathname;

        // --- Public /v1/* API for the Android client (anonymous, no admin API_KEY) ---
        // Auth is per-device: requires X-Device-Id (sha256 hex of the install UUID).
        if (path.startsWith("/v1/")) {
            try {
                return await handleV1(request, env, ctx, url, path);
            } catch (err) {
                console.error("v1 worker error:", err);
                return cors(json({ error: err.message || "internal" }, 500));
            }
        }

        // Auth check (admin / desktop client)
        const apiKey = request.headers.get("X-API-Key");
        if (apiKey !== env.API_KEY) {
            return cors(json({ error: "Unauthorized" }, 401));
        }

        try {
            if (path === "/api/health") {
                // Quick health check — try a simple query
                const conn = await getConn(env);
                await conn.query("SELECT 1");
                conn.end();
                return cors(json({ status: "ok", worker: "cf-ip-scanner-db-proxy", hyperdrive: true }));
            }

            if (request.method !== "POST") {
                return cors(json({ error: "Method not allowed" }, 405));
            }

            const body = await request.json().catch(() => ({}));

            if (path === "/api/analytics") {
                const provider = body.provider || "cloudflare";
                const now = Date.now();
                const cached = analyticsCache.get(provider);

                if (cached && now - cached.time < 15 * 60 * 1000) { // 15 mins
                    return cors(json(cached.data));
                }

                const conn = await getConn(env);
                try {
                    const result = await handleAnalytics(conn, body);
                    analyticsCache.set(provider, { time: now, data: result });
                    return cors(json(result));
                } finally {
                    conn.end();
                }
            }

            const conn = await getConn(env);

            try {
                let result;
                switch (path) {
                    case "/api/save-scan":
                        result = await handleSaveScan(conn, body);
                        break;
                    case "/api/historical-ips":
                        result = await handleHistoricalIPs(conn, body);
                        break;
                    case "/api/community-ips":
                        result = await handleCommunityIPs(conn, body);
                        break;
                    case "/api/analytics":
                        result = await handleAnalytics(conn, body);
                        break;
                    case "/api/geo-analytics":
                        result = await handleGeoAnalytics(conn, body);
                        break;
                    case "/api/log-usage":
                        result = await handleLogUsage(conn, body);
                        break;
                    case "/api/country-domains":
                        result = await handleCountryDomains(conn, body);
                        break;
                    case "/api/save-country-domains":
                        result = await handleSaveCountryDomains(conn, body);
                        break;
                    case "/api/smart-recommend":
                        result = await handleSmartRecommend(conn, body);
                        break;
                    case "/api/log-bypass":
                        result = await handleLogBypass(conn, body);
                        break;
                    case "/api/best-bypasses":
                        result = await handleBestBypasses(conn, body);
                        break;
                    case "/api/user-contributions":
                        result = await handleUserContributions(conn, body);
                        break;
                    case "/api/user-recent-contributions":
                        result = await handleUserRecentContributions(conn, body);
                        break;
                    default:
                        return cors(json({ error: "Not found" }, 404));
                }
                return cors(json(result));
            } finally {
                conn.end();
            }
        } catch (err) {
            console.error("Worker error:", err);
            return cors(json({ error: err.message }, 500));
        }
    },
};

async function handleLogBypass(conn, body) {
    if (!body || !body.isp) return { error: "Missing isp" };
    const res = await conn.execute(
        `INSERT INTO advanced_bypass_logs (timestamp, user_isp, bypass_mode, fragment_length, fragment_interval, test_sni, ping)
         VALUES (NOW(), ?, ?, ?, ?, ?, ?)`,
        [body.isp, body.mode, body.length || '', body.interval || '', body.sni || '', body.ping || 0]
    );
    return { status: "ok" };
}

async function handleBestBypasses(conn, body) {
    if (!body || !body.isp || !body.mode) return { error: "Missing isp or mode" };
    let rows;
    if (body.mode === 'fragment') {
        rows = await conn.execute(
            `SELECT fragment_length as length, fragment_interval as \`interval\`, 
                    COUNT(*) as success_count, ROUND(AVG(ping), 1) as avg_ping
             FROM advanced_bypass_logs 
             WHERE bypass_mode = 'fragment' AND user_isp = ?
               AND fragment_length IS NOT NULL AND fragment_interval IS NOT NULL
               AND fragment_length != 'Unknown' AND fragment_interval != 'Unknown'
             GROUP BY fragment_length, fragment_interval
             ORDER BY success_count DESC, avg_ping ASC
             LIMIT ?`,
            [body.isp, body.limit || 5]
        );
    } else if (body.mode === 'sni') {
        rows = await conn.execute(
            `SELECT test_sni as sni, COUNT(*) as success_count, ROUND(AVG(ping), 1) as avg_ping
             FROM advanced_bypass_logs
             WHERE bypass_mode = 'sni' AND user_isp = ?
               AND test_sni IS NOT NULL AND test_sni != 'Unknown'
             GROUP BY test_sni
             ORDER BY success_count DESC, avg_ping ASC
             LIMIT ?`,
            [body.isp, body.limit || 5]
        );
    } else {
        return { error: "Invalid mode" };
    }
    return { results: rows.rows };
}

async function handleUserContributions(conn, body) {
    if (!body || !body.user_ip || !body.isp) return { error: "Missing user_ip or isp" };

    const [rows] = await conn.execute(
        `SELECT COUNT(*) as total_scans 
         FROM scan_results 
         WHERE status = 'ok' AND user_ip = ? AND user_isp = ?`,
        [body.user_ip, body.isp]
    );
    return { total_scans: rows[0].total_scans || 0 };
}

async function handleUserRecentContributions(conn, body) {
    if (!body || !body.user_ip || !body.isp) return { error: "Missing user_ip or isp" };

    // Check if user has scanned successfully in the last 3 days
    const [rows] = await conn.execute(
        `SELECT COUNT(*) as recent_scans 
         FROM scan_results 
         WHERE status = 'ok' 
           AND user_ip = ? 
           AND user_isp = ? 
           AND timestamp >= DATE_SUB(NOW(), INTERVAL 3 DAY)`,
        [body.user_ip, body.isp]
    );
    return { recent_scans: rows[0].recent_scans || 0 };
}

async function getConn(env) {
    return mysql.createConnection({
        uri: env.HYPERDRIVE.connectionString,
        disableEval: true
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function cors(response) {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    return response;
}

// --- Handlers ---

async function handleSaveScan(conn, body) {
    await conn.query(
        `INSERT INTO scan_results 
     (timestamp, user_ip, user_location, user_isp, vless_uuid, scanned_ip, 
      ip_source, ping, jitter, download, upload, status, datacenter, asn, 
      network_type, port, sni, app_version, provider)
     VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            body.user_ip || "Unknown", body.user_location || "Unknown",
            body.user_isp || "Unknown", body.vless_uuid || "Unknown",
            body.scanned_ip || "Unknown", body.ip_source || "Unknown",
            body.ping ?? -1, body.jitter ?? -1,
            body.download ?? -1, body.upload ?? -1,
            body.status || "Unknown", body.datacenter || "Unknown",
            body.asn || "Unknown", body.network_type || "Unknown",
            body.port ?? -1, body.sni || "Unknown",
            body.app_version || "1.0.0", body.provider || "cloudflare",
        ]
    );
    return { ok: true };
}

async function handleHistoricalIPs(conn, body) {
    const { isp, location, limit = 100 } = body;
    const [rows] = await conn.query(
        `SELECT DISTINCT scanned_ip FROM scan_results 
     WHERE status = 'ok' AND ping < 300 AND download > 5
       AND (user_isp = ? OR user_location = ?)
     ORDER BY timestamp DESC LIMIT ?`,
        [isp || "", location || "", limit]
    );
    return { ips: rows.map((r) => r.scanned_ip) };
}

async function handleCommunityIPs(conn, body) {
    const { country, isp, limit = 50 } = body;
    const like = country ? `${country}%` : "%";
    const [rows] = await conn.query(
        `SELECT DISTINCT scanned_ip FROM scan_results 
     WHERE status = 'ok' 
       AND (user_location LIKE ? OR user_isp = ?)
       AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY download DESC, ping ASC LIMIT ?`,
        [like, isp || "", limit]
    );
    return { ips: rows.map((r) => r.scanned_ip) };
}

async function handleSmartRecommend(conn, body) {
    const { isp = "", location = "", country = "", limit = 30 } = body;
    const scoreQuery = (filter) => `
        SELECT scanned_ip,
            COUNT(*) as total_tests,
            ROUND(AVG(ping), 1) as avg_ping,
            ROUND(AVG(jitter), 1) as avg_jitter,
            ROUND(AVG(download), 2) as avg_download,
            ROUND(AVG(upload), 2) as avg_upload,
            SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as success_count,
            MAX(timestamp) as last_seen,
            ROUND(
                (SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) * 100.0 / COUNT(*))
                + GREATEST(100 - AVG(ping), 0)
                + (AVG(download) * 2)
                - (AVG(jitter) * 0.5)
            , 1) as score
        FROM scan_results
        WHERE status = 'ok'
          AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND ${filter}
        GROUP BY scanned_ip
        HAVING total_tests >= 2
        ORDER BY score DESC
        LIMIT ?
    `;

    const results = [];
    const seen = new Set();

    // Tier 1: Same ISP (60%)
    const t1 = Math.max(Math.floor(limit * 0.6), 5);
    const [rows1] = await conn.query(scoreQuery("user_isp = ?"), [isp, t1]);
    for (const r of rows1) {
        if (!seen.has(r.scanned_ip)) {
            seen.add(r.scanned_ip);
            results.push({ ...r, tier: "isp", last_seen: String(r.last_seen) });
        }
    }

    // Tier 2: Same Region (30%)
    const t2 = Math.max(Math.floor(limit * 0.3), 3);
    const like = country ? `${country}%` : "%";
    const [rows2] = await conn.query(scoreQuery("user_location LIKE ?"), [like, t2]);
    for (const r of rows2) {
        if (!seen.has(r.scanned_ip)) {
            seen.add(r.scanned_ip);
            results.push({ ...r, tier: "region", last_seen: String(r.last_seen) });
        }
    }

    // Tier 3: Global Best (10%)
    const t3 = Math.max(Math.floor(limit * 0.1), 2);
    const [rows3] = await conn.query(scoreQuery("1=1"), [t3]);
    for (const r of rows3) {
        if (!seen.has(r.scanned_ip)) {
            seen.add(r.scanned_ip);
            results.push({ ...r, tier: "global", last_seen: String(r.last_seen) });
        }
    }

    return { results, total: results.length };
}

async function handleAnalytics(conn, body) {
    const p = body.provider || "cloudflare";

    const [[datacenters], [ports], [networks], [totalRow], [goodRow], [timeline], [asns], [isps], [fails]] =
        await Promise.all([
            conn.query(
                `SELECT datacenter, COUNT(*) as count, ROUND(AVG(ping)) as avg_ping 
         FROM scan_results WHERE status='ok' AND datacenter != 'Unknown' AND datacenter IS NOT NULL AND provider=? AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY datacenter ORDER BY count DESC LIMIT 10`, [p]),
            conn.query(
                `SELECT port, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND port != -1 AND port IS NOT NULL AND provider=? AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY port ORDER BY count DESC LIMIT 5`, [p]),
            conn.query(
                `SELECT network_type, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND network_type != 'Unknown' AND network_type IS NOT NULL AND provider=? AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY network_type ORDER BY count DESC`, [p]),
            conn.query(`SELECT COUNT(*) as count FROM scan_results WHERE provider=?`, [p]),
            conn.query(`SELECT COUNT(*) as count FROM scan_results WHERE status='ok' AND provider=?`, [p]),
            conn.query(
                `SELECT DATE(timestamp) as date, COUNT(*) as total_scans,
                SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as successful_scans
         FROM scan_results WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) AND provider=?
         GROUP BY DATE(timestamp) ORDER BY date ASC`, [p]),
            conn.query(
                `SELECT asn, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND asn != 'Unknown' AND asn IS NOT NULL AND provider=? AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY asn ORDER BY count DESC LIMIT 5`, [p]),
            conn.query(
                `SELECT user_isp as isp, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND user_isp != 'Unknown' AND user_isp IS NOT NULL AND provider=? AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY user_isp ORDER BY count DESC LIMIT 5`, [p]),
            conn.query(
                `SELECT status as fail_reason, COUNT(*) as count FROM scan_results 
         WHERE status != 'ok' AND provider=? AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY status`, [p])
        ]);

    return {
        top_datacenters: datacenters,
        top_ports: ports,
        network_types: networks,
        top_asns: asns,
        top_isps: isps,
        fail_reasons: fails,
        total_scans: totalRow[0]?.count || 0,
        total_good: goodRow[0]?.count || 0,
        timeline_data: timeline.map((r) => ({
            date: r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date),
            total_scans: Number(r.total_scans) || 0,
            successful_scans: Number(r.successful_scans) || 0,
        })),
    };
}

async function handleGeoAnalytics(conn, body) {
    const p = body.provider || "cloudflare";
    const [rows] = await conn.query(
        `SELECT 
       TRIM(SUBSTRING_INDEX(user_location, ' - ', 1)) as country,
       COUNT(*) as total_scans,
       SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as good_ips,
       ROUND(AVG(CASE WHEN ping > 0 THEN ping ELSE NULL END)) as avg_ping,
       ROUND(AVG(CASE WHEN download > 0 THEN download ELSE NULL END), 1) as avg_download,
       COUNT(DISTINCT user_ip) as unique_users
     FROM scan_results 
     WHERE user_location IS NOT NULL AND user_location != 'Unknown' AND provider=? AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
     GROUP BY country HAVING total_scans > 0
     ORDER BY total_scans DESC`,
        [p]
    );

    return rows.map((r) => ({
        country: r.country,
        total_scans: Number(r.total_scans) || 0,
        good_ips: Number(r.good_ips) || 0,
        success_rate: r.total_scans > 0 ? Math.round((r.good_ips / r.total_scans) * 1000) / 10 : 0,
        avg_ping: r.avg_ping != null ? Number(r.avg_ping) : null,
        avg_download: r.avg_download != null ? Number(r.avg_download) : null,
        unique_users: Number(r.unique_users) || 0,
    }));
}

async function handleLogUsage(conn, body) {
    await conn.query(
        `INSERT INTO app_usage_logs (timestamp, user_ip, user_location, user_isp, event_type, details)
     VALUES (NOW(), ?, ?, ?, ?, ?)`,
        [body.ip || "Unknown", body.location || "Unknown", body.isp || "Unknown",
        body.event_type || "unknown", body.details || ""]
    );
    return { ok: true };
}

async function handleCountryDomains(conn, body) {
    const [rows] = await conn.query(
        `SELECT domains, last_updated FROM country_domains WHERE country = ?`,
        [body.country || ""]
    );
    if (rows.length > 0) {
        return {
            domains: rows[0].domains ? rows[0].domains.split(",") : [],
            last_updated: rows[0].last_updated,
        };
    }
    return { domains: null };
}

async function handleSaveCountryDomains(conn, body) {
    const domains = (body.domains || []).join(",");
    await conn.query(
        `INSERT INTO country_domains (country, domains, last_updated)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE domains=?, last_updated=NOW()`,
        [body.country || "", domains, domains]
    );
    return { ok: true };
}

// ============================================================================
// /v1/* — Public REST API for the Android client
// ----------------------------------------------------------------------------
// Auth:   X-Device-Id header (sha256 hex of the install UUID; opaque to server,
//         used only as a rate-limit key — no PII).
// Cache:  Best-IPs and SNI bank are cached per (cc,isp) for 5 min in worker mem.
// Schema: First write to mobile_scan_results auto-creates the table.
// ============================================================================

const v1Cache = new Map(); // key -> { time, data }
const V1_CACHE_TTL_MS = 5 * 60 * 1000;
const V1_BEST_IPS_LIMIT_MAX = 200;
const V1_BATCH_LIMIT = 200;

// Curated SNI bank per country code. These mirror the desktop scanner's
// fronting bank (worker subdomains that historically bypass DPI).
const V1_SNI_BANK_DEFAULT = [
    "speed.cloudflare.com",
    "cdnjs.cloudflare.com",
    "1.1.1.1.cloudflare-dns.com",
    "www.visa.com",
    "discord.com",
];
const V1_SNI_BANK_BY_CC = {
    IR: ["speed.cloudflare.com", "cdnjs.cloudflare.com", "www.visa.com", "discord.com", "1.1.1.1.cloudflare-dns.com"],
    RU: ["speed.cloudflare.com", "cdnjs.cloudflare.com", "1.1.1.1.cloudflare-dns.com", "www.cloudflare.com"],
    CN: ["cdnjs.cloudflare.com", "1.1.1.1.cloudflare-dns.com", "speed.cloudflare.com"],
};

const V1_LATEST_VERSION = {
    versionCode: 238,
    versionName: "2.3.8",
    minSupportedVersionCode: 1,
    apkUrl: "https://github.com/Khate-Tire/CF-IP-Scanner/releases/tag/v2.3.8",
    sha256: null,
    changelog: "v2.3.8: Publish Android APKs alongside desktop installers; CI fixes for VPN binary fallback and APK extraction.",
    forceUpdate: false,
};

async function handleV1(request, env, ctx, url, path) {
    const deviceId = request.headers.get("X-Device-Id") || "";
    // Allow /v1/version and /v1/community-stats without a device id (cold-start).
    const requiresDevice = !(path === "/v1/version" || path === "/v1/community-stats");
    if (requiresDevice && !/^[a-f0-9]{32,128}$/i.test(deviceId)) {
        return cors(json({ error: "Missing or invalid X-Device-Id" }, 401));
    }

    if (request.method === "GET") {
        if (path === "/v1/version") {
            return cors(json(V1_LATEST_VERSION));
        }
        if (path === "/v1/best-ips") {
            const cc = (url.searchParams.get("cc") || "").toUpperCase().slice(0, 4);
            const isp = (url.searchParams.get("isp") || "").slice(0, 80);
            const asn = (url.searchParams.get("asn") || "").slice(0, 32);
            const limit = clampInt(url.searchParams.get("limit"), 50, 1, V1_BEST_IPS_LIMIT_MAX);
            return await v1BestIps(env, cc, isp, asn, limit);
        }
        if (path === "/v1/sni-bank") {
            const cc = (url.searchParams.get("cc") || "").toUpperCase().slice(0, 4);
            const banks = V1_SNI_BANK_BY_CC[cc] || V1_SNI_BANK_DEFAULT;
            return cors(json({ cc, snis: banks }));
        }
        if (path === "/v1/community-stats") {
            return await v1CommunityStats(env);
        }
        if (path === "/v1/leaderboard") {
            const cc = (url.searchParams.get("cc") || "").toUpperCase().slice(0, 4);
            return await v1Leaderboard(env, cc, deviceId);
        }
        return cors(json({ error: "Not found" }, 404));
    }

    if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (path === "/v1/scan-result") {
            return await v1ScanResult(env, deviceId, body);
        }
        if (path === "/v1/scan-results-batch") {
            return await v1ScanResultsBatch(env, deviceId, body);
        }
        if (path === "/v1/scan-shard/claim") {
            return await v1ShardClaim(env, deviceId, body);
        }
        if (path === "/v1/scan-shard/complete") {
            return await v1ShardComplete(env, deviceId, body);
        }
        return cors(json({ error: "Not found" }, 404));
    }

    return cors(json({ error: "Method not allowed" }, 405));
}

function clampInt(v, def, min, max) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}

async function v1BestIps(env, cc, isp, asn, limit) {
    const cacheKey = `bestips:${cc}:${isp}:${asn}:${limit}`;
    const cached = v1Cache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.time < V1_CACHE_TTL_MS) {
        return cors(json(cached.data));
    }

    const conn = await getConn(env);
    try {
        await ensureMobileTable(conn);
        // Tiered selection — desktop scan_results UNION ALL mobile_scan_results
        // so VPN community scans contribute to the same ranking signal:
        //   T0: same ASN within 7 days     (mobile only — desktop has no asn match key)
        //   T1: same ISP within 7 days     (both tables)
        //   T2: same country within 7 days (both tables)
        //   T3: global within 7 days       (both tables)
        const seen = new Set();
        const results = [];

        // Unified subquery — `user_isp / user_location` come from desktop,
        // `isp / cc` come from mobile. We project them to a common shape.
        // device_id is `'desktop'` for the desktop table (we don't track per-
        // user there) so desktop rows count as a single confirming source —
        // mobile rows contribute one distinct device per device_uuid_hash.
        const unifiedFrom = `
            (SELECT scanned_ip, ping, jitter, download, upload, status,
                    user_isp AS u_isp, user_location AS u_loc, asn AS u_asn,
                    'desktop' AS u_dev, timestamp
             FROM scan_results
             WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
             UNION ALL
             SELECT scanned_ip, ping, jitter, download, upload, status,
                    isp AS u_isp, cc AS u_loc, asn AS u_asn,
                    device_uuid_hash AS u_dev, timestamp
             FROM mobile_scan_results
             WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)) u
        `;

        // Community confirmation gate — to be returned as a "best IP" we now
        // require:
        //   * at least 2 successful samples in the last 7 days
        //   * at least 2 distinct contributing devices (desktop counts as 1)
        //   * a fresh confirmation within the last 24 hours (aging)
        //   * BOTH avg_download AND avg_upload > 0 (no ping-only "clean" IPs)
        // This implements the user's vision of sharded, repeatedly-confirmed
        // community discovery rather than promoting one-off lucky probes.
        const score = (filterSql, params, take) =>
            conn.query(
                `SELECT scanned_ip,
                        ROUND(AVG(ping), 1) as avg_ping,
                        ROUND(AVG(jitter), 1) as avg_jitter,
                        ROUND(AVG(download), 2) as avg_download,
                        ROUND(AVG(upload), 2) as avg_upload,
                        SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as ok_count,
                        COUNT(*) as total,
                        COUNT(DISTINCT u_dev) as confirmations,
                        MAX(timestamp) as last_seen,
                        ROUND(
                            (SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) * 100.0 / COUNT(*))
                            + GREATEST(150 - AVG(ping), 0)
                            + (AVG(download) * 1.5)
                            + (AVG(upload) * 1.0)
                            - (AVG(jitter) * 0.5)
                        , 1) as score
                 FROM ${unifiedFrom}
                 WHERE ${filterSql}
                 GROUP BY scanned_ip
                 HAVING ok_count >= 2
                    AND confirmations >= 2
                    AND avg_download > 0
                    AND avg_upload > 0
                    AND MAX(timestamp) > DATE_SUB(NOW(), INTERVAL 24 HOUR)
                 ORDER BY score DESC
                 LIMIT ?`,
                [...params, take]
            );

        const tASNTake = asn ? Math.max(1, Math.floor(limit * 0.4)) : 0;
        const t1Take   = Math.max(1, Math.floor(limit * (asn ? 0.3 : 0.6)));
        const t2Take   = Math.max(1, Math.floor(limit * 0.2));
        const t3Take   = Math.max(1, limit - tASNTake - t1Take - t2Take);

        if (asn) {
            const [r0] = await score("u_asn = ?", [asn], tASNTake);
            for (const r of r0) if (!seen.has(r.scanned_ip)) { seen.add(r.scanned_ip); results.push(toBestIp(r, "asn")); }
        }
        if (isp) {
            const [r1] = await score("u_isp = ?", [isp], t1Take);
            for (const r of r1) if (!seen.has(r.scanned_ip)) { seen.add(r.scanned_ip); results.push(toBestIp(r, "isp")); }
        }
        if (cc) {
            const [r2] = await score("u_loc LIKE ?", [`${cc}%`], t2Take);
            for (const r of r2) if (!seen.has(r.scanned_ip)) { seen.add(r.scanned_ip); results.push(toBestIp(r, "country")); }
        }
        const [r3] = await score("1=1", [], t3Take);
        for (const r of r3) if (!seen.has(r.scanned_ip)) { seen.add(r.scanned_ip); results.push(toBestIp(r, "global")); }

        const data = { cc, isp, asn, results: results.slice(0, limit), count: Math.min(results.length, limit) };
        v1Cache.set(cacheKey, { time: now, data });
        return cors(json(data));
    } finally {
        conn.end();
    }
}

function toBestIp(row, tier) {
    return {
        ip: row.scanned_ip,
        avg_ping: row.avg_ping != null ? Number(row.avg_ping) : null,
        avg_jitter: row.avg_jitter != null ? Number(row.avg_jitter) : null,
        avg_download: row.avg_download != null ? Number(row.avg_download) : null,
        avg_upload: row.avg_upload != null ? Number(row.avg_upload) : null,
        success_rate: row.total > 0 ? Math.round((Number(row.ok_count) / Number(row.total)) * 1000) / 10 : 0,
        confirmations: row.confirmations != null ? Number(row.confirmations) : null,
        last_seen: row.last_seen || null,
        score: row.score != null ? Number(row.score) : null,
        tier,
        // shareable=false hides the IP from the user UI; only IPs the user
        // discovers via their own scan are shown as "shareable".
        shareable: false,
    };
}

async function v1ScanResult(env, deviceId, body) {
    if (!body || !body.ip) return cors(json({ error: "Missing ip" }, 400));
    const conn = await getConn(env);
    try {
        await ensureMobileTable(conn);
        await conn.execute(
            `INSERT INTO mobile_scan_results
                (timestamp, device_uuid_hash, app_version, cc, isp,
                 scanned_ip, port, sni, ping, jitter, download, upload,
                 status, datacenter, asn, network_type)
             VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                deviceId,
                String(body.app_version || "0.1.0").slice(0, 16),
                String(body.cc || "").toUpperCase().slice(0, 4),
                String(body.isp || "").slice(0, 80),
                String(body.ip).slice(0, 64),
                Number.isFinite(body.port) ? body.port : -1,
                String(body.sni || "").slice(0, 128),
                Number.isFinite(body.ping) ? body.ping : -1,
                Number.isFinite(body.jitter) ? body.jitter : -1,
                Number.isFinite(body.download) ? body.download : -1,
                Number.isFinite(body.upload) ? body.upload : -1,
                String(body.status || "unknown").slice(0, 32),
                String(body.datacenter || "").slice(0, 16),
                String(body.asn || "").slice(0, 32),
                String(body.network_type || "").slice(0, 16),
            ]
        );
        return cors(json({ ok: true }));
    } finally {
        conn.end();
    }
}

async function v1ScanResultsBatch(env, deviceId, body) {
    const items = Array.isArray(body && body.results) ? body.results : null;
    if (!items || items.length === 0) return cors(json({ error: "Empty batch" }, 400));
    if (items.length > V1_BATCH_LIMIT) {
        return cors(json({ error: `Batch too large (>${V1_BATCH_LIMIT})` }, 413));
    }
    const conn = await getConn(env);
    try {
        await ensureMobileTable(conn);
        const cc = String((body && body.cc) || "").toUpperCase().slice(0, 4);
        const isp = String((body && body.isp) || "").slice(0, 80);
        const appVersion = String((body && body.app_version) || "0.1.0").slice(0, 16);

        const placeholders = items.map(() =>
            "(NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).join(", ");
        const params = [];
        for (const r of items) {
            params.push(
                deviceId, appVersion, cc, isp,
                String(r.ip || "").slice(0, 64),
                Number.isFinite(r.port) ? r.port : -1,
                String(r.sni || "").slice(0, 128),
                Number.isFinite(r.ping) ? r.ping : -1,
                Number.isFinite(r.jitter) ? r.jitter : -1,
                Number.isFinite(r.download) ? r.download : -1,
                Number.isFinite(r.upload) ? r.upload : -1,
                String(r.status || "unknown").slice(0, 32),
                String(r.datacenter || "").slice(0, 16),
                String(r.asn || "").slice(0, 32),
                String(r.network_type || "").slice(0, 16),
            );
        }
        await conn.query(
            `INSERT INTO mobile_scan_results
                (timestamp, device_uuid_hash, app_version, cc, isp,
                 scanned_ip, port, sni, ping, jitter, download, upload,
                 status, datacenter, asn, network_type)
             VALUES ${placeholders}`,
            params
        );
        return cors(json({ ok: true, accepted: items.length }));
    } finally {
        conn.end();
    }
}

async function v1CommunityStats(env) {
    const cacheKey = "communityStats";
    const now = Date.now();
    const cached = v1Cache.get(cacheKey);
    if (cached && now - cached.time < V1_CACHE_TTL_MS) {
        return cors(json(cached.data));
    }
    const conn = await getConn(env);
    try {
        await ensureMobileTable(conn);
        const [[totals], [active], [topCc]] = await Promise.all([
            conn.query(
                `SELECT COUNT(DISTINCT scanned_ip) as ips_total,
                        COUNT(*) as samples_total
                 FROM mobile_scan_results
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)`
            ),
            conn.query(
                `SELECT COUNT(DISTINCT device_uuid_hash) as users_active
                 FROM mobile_scan_results
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            ),
            conn.query(
                `SELECT cc, COUNT(DISTINCT device_uuid_hash) as users
                 FROM mobile_scan_results
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
                   AND cc != ''
                 GROUP BY cc
                 ORDER BY users DESC
                 LIMIT 10`
            ),
        ]);
        const data = {
            ips_total: Number(totals[0]?.ips_total || 0),
            samples_total: Number(totals[0]?.samples_total || 0),
            users_active_24h: Number(active[0]?.users_active || 0),
            top_countries_24h: topCc.map((r) => ({
                cc: r.cc, users: Number(r.users) || 0,
            })),
        };
        v1Cache.set(cacheKey, { time: now, data });
        return cors(json(data));
    } finally {
        conn.end();
    }
}

async function v1Leaderboard(env, cc, deviceId) {
    const conn = await getConn(env);
    try {
        await ensureMobileTable(conn);
        const ccFilter = cc ? "AND cc = ?" : "";
        const params = cc ? [cc] : [];
        const [rows] = await conn.query(
            `SELECT device_uuid_hash, COUNT(*) as contributions
             FROM mobile_scan_results
             WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
               ${ccFilter}
             GROUP BY device_uuid_hash
             ORDER BY contributions DESC
             LIMIT 1000`,
            params
        );
        let myRank = null;
        let myCount = 0;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].device_uuid_hash === deviceId) {
                myRank = i + 1;
                myCount = Number(rows[i].contributions) || 0;
                break;
            }
        }
        return cors(json({
            cc: cc || null,
            total_devices: rows.length,
            my_rank: myRank,
            my_contributions_24h: myCount,
        }));
    } finally {
        conn.end();
    }
}

let _mobileTableEnsured = false;
async function ensureMobileTable(conn) {
    if (_mobileTableEnsured) return;
    await conn.query(`
        CREATE TABLE IF NOT EXISTS mobile_scan_results (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            timestamp DATETIME NOT NULL,
            device_uuid_hash VARCHAR(128) NOT NULL,
            app_version VARCHAR(16) NOT NULL DEFAULT '',
            cc VARCHAR(4) NOT NULL DEFAULT '',
            isp VARCHAR(80) NOT NULL DEFAULT '',
            scanned_ip VARCHAR(64) NOT NULL,
            port INT NOT NULL DEFAULT -1,
            sni VARCHAR(128) NOT NULL DEFAULT '',
            ping INT NOT NULL DEFAULT -1,
            jitter INT NOT NULL DEFAULT -1,
            download DECIMAL(8,2) NOT NULL DEFAULT -1,
            upload DECIMAL(8,2) NOT NULL DEFAULT -1,
            status VARCHAR(32) NOT NULL DEFAULT 'unknown',
            datacenter VARCHAR(16) NOT NULL DEFAULT '',
            asn VARCHAR(32) NOT NULL DEFAULT '',
            network_type VARCHAR(16) NOT NULL DEFAULT '',
            INDEX idx_mobile_time (timestamp),
            INDEX idx_mobile_cc_isp_time (cc, isp, timestamp),
            INDEX idx_mobile_device_time (device_uuid_hash, timestamp),
            INDEX idx_mobile_scanned_ip (scanned_ip)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    _mobileTableEnsured = true;
}

// ============================================================================
// Shard coordination — scan_shards table + claim/complete endpoints
// ============================================================================
// When the per-ISP DB is exhausted, VPN clients claim a /24 of CF address
// space, scan all 256 IPs, and submit results back. Lease prevents two
// devices from scanning the same shard simultaneously.

let _shardTableEnsured = false;
async function ensureShardTable(conn) {
    if (_shardTableEnsured) return;
    await conn.query(`
        CREATE TABLE IF NOT EXISTS scan_shards (
            shard_cidr VARCHAR(32) NOT NULL PRIMARY KEY,
            last_scanned_at DATETIME DEFAULT NULL,
            scanned_by_device VARCHAR(128) DEFAULT NULL,
            ok_count INT NOT NULL DEFAULT 0,
            total_count INT NOT NULL DEFAULT 0,
            lease_owner VARCHAR(128) DEFAULT NULL,
            lease_expires_at DATETIME DEFAULT NULL,
            INDEX idx_shard_lease_exp (lease_expires_at),
            INDEX idx_shard_scanned (last_scanned_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    _shardTableEnsured = true;
}

// Hardcoded CF /24 universe — derived from official AS13335 prefixes,
// expanded to /24s. ~3000 shards covering the bulk of CF anycast space.
// Stored as ranges to avoid a 60KB constant; expanded on first claim.
const CF_PREFIXES = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];

function expandPrefixToSlash24(cidr) {
    const [base, bitsStr] = cidr.split("/");
    const bits = parseInt(bitsStr, 10);
    if (bits >= 24) return [`${base}/24`];
    const [a, b, c] = base.split(".").map(n => parseInt(n, 10));
    const count = 1 << (24 - bits);
    const out = [];
    let cBase = c;
    let bBase = b;
    let aBase = a;
    for (let i = 0; i < count; i++) {
        out.push(`${aBase}.${bBase}.${cBase}.0/24`);
        cBase++;
        if (cBase > 255) { cBase = 0; bBase++; }
        if (bBase > 255) { bBase = 0; aBase++; }
    }
    return out;
}

let _allCfShardsCache = null;
function allCfShards() {
    if (_allCfShardsCache) return _allCfShardsCache;
    const out = [];
    for (const p of CF_PREFIXES) {
        for (const s of expandPrefixToSlash24(p)) out.push(s);
    }
    _allCfShardsCache = out;
    return out;
}

const SHARD_LEASE_MIN = 30; // minutes
const SHARD_RESCAN_DAYS = 7;

async function v1ShardClaim(env, deviceId, _body) {
    const conn = await getConn(env);
    try {
        await ensureShardTable(conn);
        // Pick a shard that:
        //   (a) has no active lease (or the lease has expired), AND
        //   (b) was either never scanned OR scanned > SHARD_RESCAN_DAYS ago.
        // Strategy: find the next un-tracked CF /24 first (cheapest), else
        // re-issue the oldest expired-lease / stale-scan row.
        const all = allCfShards();
        const pickRandomFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];

        // Random sample of 32 shards to check tracked state — avoids
        // sending all ~3000 over the wire on every claim.
        const sample = [];
        for (let i = 0; i < 32; i++) sample.push(pickRandomFrom(all));
        const placeholders = sample.map(() => "?").join(",");
        const [tracked] = await conn.query(
            `SELECT shard_cidr, last_scanned_at, lease_expires_at
             FROM scan_shards
             WHERE shard_cidr IN (${placeholders})`,
            sample
        );
        const trackedMap = new Map(tracked.map(r => [r.shard_cidr, r]));

        let chosen = null;
        // Prefer a sampled shard that's never been seen.
        for (const s of sample) {
            if (!trackedMap.has(s)) { chosen = s; break; }
        }
        // Else accept one whose lease has expired AND scan is stale.
        if (!chosen) {
            const now = Date.now();
            for (const r of tracked) {
                const leaseExp = r.lease_expires_at ? new Date(r.lease_expires_at).getTime() : 0;
                const lastScan = r.last_scanned_at ? new Date(r.last_scanned_at).getTime() : 0;
                const stale = lastScan === 0 || (now - lastScan) > SHARD_RESCAN_DAYS * 86400_000;
                if (leaseExp < now && stale) { chosen = r.shard_cidr; break; }
            }
        }
        if (!chosen) {
            // Worst case: every sampled shard is fresh. Tell client to retry later.
            return cors(json({ ok: false, retry_after_sec: 300, reason: "no_shard_available" }));
        }
        const leaseExpires = new Date(Date.now() + SHARD_LEASE_MIN * 60_000);
        await conn.query(
            `INSERT INTO scan_shards (shard_cidr, lease_owner, lease_expires_at)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE lease_owner = VALUES(lease_owner),
                                     lease_expires_at = VALUES(lease_expires_at)`,
            [chosen, deviceId, leaseExpires]
        );
        return cors(json({
            ok: true,
            shard: chosen,
            lease_expires_at: leaseExpires.toISOString(),
            lease_minutes: SHARD_LEASE_MIN,
        }));
    } finally {
        conn.end();
    }
}

async function v1ShardComplete(env, deviceId, body) {
    const shard = String((body && body.shard) || "").slice(0, 32);
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(shard)) {
        return cors(json({ error: "Invalid shard" }, 400));
    }
    const okCount = Number.isFinite(body && body.ok_count) ? body.ok_count : 0;
    const totalCount = Number.isFinite(body && body.total_count) ? body.total_count : 0;
    const conn = await getConn(env);
    try {
        await ensureShardTable(conn);
        await conn.query(
            `UPDATE scan_shards
             SET last_scanned_at = NOW(),
                 scanned_by_device = ?,
                 ok_count = ?,
                 total_count = ?,
                 lease_owner = NULL,
                 lease_expires_at = NULL
             WHERE shard_cidr = ? AND (lease_owner = ? OR lease_owner IS NULL)`,
            [deviceId, okCount, totalCount, shard, deviceId]
        );
        return cors(json({ ok: true }));
    } finally {
        conn.end();
    }
}


