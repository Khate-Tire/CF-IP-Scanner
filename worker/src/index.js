/**
 * Cloudflare Worker — DB Proxy for Antigravity IP Scanner
 * Copyright (c) 2026 Taher AkbariSaeed
 *
 * Uses Cloudflare Hyperdrive for direct MySQL access via edge network.
 * This makes the DB accessible through Cloudflare's infrastructure,
 * which is nearly impossible for ISPs to block.
 *
 * Hyperdrive binding: HYPERDRIVE (configured in wrangler.toml)
 * Env var: API_KEY (for request authentication)
 */

import mysql from "mysql2/promise";

export default {
    async fetch(request, env, ctx) {
        // CORS preflight
        if (request.method === "OPTIONS") {
            return cors(new Response(null, { status: 204 }));
        }

        // Auth check
        const apiKey = request.headers.get("X-API-Key");
        if (apiKey !== env.API_KEY) {
            return cors(json({ error: "Unauthorized" }, 401));
        }

        const url = new URL(request.url);
        const path = url.pathname;

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
                const cacheUrl = new URL(request.url);
                cacheUrl.searchParams.set("provider", body.provider || "cloudflare");
                const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
                const cache = caches.default;

                let response = await cache.match(cacheKey);
                if (response) {
                    return cors(response);
                }

                const conn = await getConn(env);
                try {
                    const result = await handleAnalytics(conn, body);
                    response = json(result);
                    response.headers.set("Cache-Control", "public, s-maxage=900");
                    ctx.waitUntil(cache.put(cacheKey, response.clone()));
                    return cors(response);
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
         FROM scan_results WHERE status='ok' AND datacenter != 'Unknown' AND datacenter IS NOT NULL AND provider=?
         GROUP BY datacenter ORDER BY count DESC LIMIT 10`, [p]),
            conn.query(
                `SELECT port, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND port != -1 AND port IS NOT NULL AND provider=?
         GROUP BY port ORDER BY count DESC LIMIT 5`, [p]),
            conn.query(
                `SELECT network_type, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND network_type != 'Unknown' AND network_type IS NOT NULL AND provider=?
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
         WHERE status='ok' AND asn != 'Unknown' AND asn IS NOT NULL AND provider=?
         GROUP BY asn ORDER BY count DESC LIMIT 5`, [p]),
            conn.query(
                `SELECT user_isp as isp, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND user_isp != 'Unknown' AND user_isp IS NOT NULL AND provider=?
         GROUP BY user_isp ORDER BY count DESC LIMIT 5`, [p]),
            conn.query(
                `SELECT status as fail_reason, COUNT(*) as count FROM scan_results 
         WHERE status != 'ok' AND provider=?
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
     WHERE user_location IS NOT NULL AND user_location != 'Unknown' AND provider=?
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
