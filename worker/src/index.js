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
    async fetch(request, env) {
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
                await conn.execute("SELECT 1");
                conn.end();
                return cors(json({ status: "ok", worker: "cf-ip-scanner-db-proxy", hyperdrive: true }));
            }

            if (request.method !== "POST") {
                return cors(json({ error: "Method not allowed" }, 405));
            }

            const body = await request.json();
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

async function getConn(env) {
    return mysql.createConnection(env.HYPERDRIVE.connectionString);
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
    await conn.execute(
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
    const [rows] = await conn.execute(
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
    const [rows] = await conn.execute(
        `SELECT DISTINCT scanned_ip FROM scan_results 
     WHERE status = 'ok' 
       AND (user_location LIKE ? OR user_isp = ?)
       AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY download DESC, ping ASC LIMIT ?`,
        [like, isp || "", limit]
    );
    return { ips: rows.map((r) => r.scanned_ip) };
}

async function handleAnalytics(conn, body) {
    const p = body.provider || "cloudflare";

    const [[datacenters], [ports], [networks], [totalRow], [goodRow], [timeline]] =
        await Promise.all([
            conn.execute(
                `SELECT datacenter, COUNT(*) as count, ROUND(AVG(ping)) as avg_ping 
         FROM scan_results WHERE status='ok' AND datacenter != 'Unknown' AND datacenter IS NOT NULL AND provider=?
         GROUP BY datacenter ORDER BY count DESC LIMIT 10`, [p]),
            conn.execute(
                `SELECT port, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND port != -1 AND port IS NOT NULL AND provider=?
         GROUP BY port ORDER BY count DESC LIMIT 5`, [p]),
            conn.execute(
                `SELECT network_type, COUNT(*) as count FROM scan_results 
         WHERE status='ok' AND network_type != 'Unknown' AND network_type IS NOT NULL AND provider=?
         GROUP BY network_type ORDER BY count DESC`, [p]),
            conn.execute(`SELECT COUNT(*) as count FROM scan_results WHERE provider=?`, [p]),
            conn.execute(`SELECT COUNT(*) as count FROM scan_results WHERE status='ok' AND provider=?`, [p]),
            conn.execute(
                `SELECT DATE(timestamp) as date, COUNT(*) as total_scans,
                SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as successful_scans
         FROM scan_results WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) AND provider=?
         GROUP BY DATE(timestamp) ORDER BY date ASC`, [p]),
        ]);

    return {
        top_datacenters: datacenters,
        top_ports: ports,
        network_types: networks,
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
    const [rows] = await conn.execute(
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
    await conn.execute(
        `INSERT INTO app_usage_logs (timestamp, user_ip, user_location, user_isp, event_type, details)
     VALUES (NOW(), ?, ?, ?, ?, ?)`,
        [body.ip || "Unknown", body.location || "Unknown", body.isp || "Unknown",
        body.event_type || "unknown", body.details || ""]
    );
    return { ok: true };
}

async function handleCountryDomains(conn, body) {
    const [rows] = await conn.execute(
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
    await conn.execute(
        `INSERT INTO country_domains (country, domains, last_updated)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE domains=?, last_updated=NOW()`,
        [body.country || "", domains, domains]
    );
    return { ok: true };
}
