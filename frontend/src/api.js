/* Copyright (c) 2026 Taher AkbariSaeed */
import { getClientId } from './utils/clientId';

// Resolve the backend URL.
// Preference order:
//  1) Vite env (VITE_API_URL) — useful for dev / docker
//  2) Electron preload-injected window.electronAPI.getBackendUrl() (resolved lazily)
//  3) Fallback to localhost:8000
export const API_URL =
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ||
    'http://127.0.0.1:8000';

// Default per-request timeout (ms). Long-running endpoints override.
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Centralised fetch wrapper.
 *  - Adds an AbortController-based timeout (default 30s).
 *  - On non-2xx, parses Pydantic 422 `detail` arrays into a readable message
 *    and throws an Error with `.status` and `.detail` populated.
 *  - On network/abort failures, throws a normalised Error.
 *
 * Returns the Response object on success — callers decide json/text/blob.
 */
async function apiFetch(path, opts = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = opts;
    const url = path.startsWith('http') ? path : `${API_URL}${path}`;
    const headers = { ...(rest.headers || {}) };
    if (rest.body && typeof rest.body === 'string' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const res = await fetch(url, { ...rest, headers, signal: controller.signal });
        if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
                const j = await res.clone().json();
                if (j && j.detail) {
                    detail = Array.isArray(j.detail)
                        ? j.detail.map(d => `${(d.loc || []).join('.')}: ${d.msg}`).join('; ')
                        : (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail));
                } else if (j && (j.message || j.error)) {
                    detail = j.message || j.error;
                }
            } catch (_) { /* not JSON */ }
            const err = new Error(detail);
            err.status = res.status;
            err.detail = detail;
            throw err;
        }
        return res;
    } catch (e) {
        if (e.name === 'AbortError') {
            const err = new Error('Request timed out');
            err.timeout = true;
            throw err;
        }
        throw e;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

/** Convenience: parse JSON, propagate errors. */
async function apiJson(path, opts = {}) {
    const res = await apiFetch(path, opts);
    return res.json();
}

/** Convenience: parse JSON, return a fallback object on any error (network/HTTP/abort). */
async function apiJsonSafe(path, opts = {}, fallback = {}) {
    try { return await apiJson(path, opts); }
    catch (e) {
        return { ...fallback, success: false, error: e.message, message: e.message };
    }
}

/** POST helper that always returns a `{success, message?, ...}` shape. */
async function apiPostSafe(path, body, opts = {}) {
    return apiJsonSafe(path, { method: 'POST', body: JSON.stringify(body || {}), ...opts });
}

// ==========================================
// CORE SCAN ENDPOINTS
// ==========================================

export const scanIPs = async (config) => apiJsonSafe('/scan', {
    method: 'POST',
    headers: { 'X-Client-ID': getClientId() },
    body: JSON.stringify(config),
}, { error: 'Failed to start scan' });

export const rescanIP = async (vlessConfig, ip) => apiJsonSafe('/rescan-ip', {
    method: 'POST',
    body: JSON.stringify({ vless_config: vlessConfig, ip }),
}, { error: 'Failed to rescan' });

export const exportSubscription = async (format, vlessConfig, ips) => apiJsonSafe('/export', {
    method: 'POST',
    body: JSON.stringify({ format, vless_config: vlessConfig, ips }),
}, { error: 'Export failed' });

export const getScanStatus = async (scanId) =>
    apiJsonSafe(`/scan/${encodeURIComponent(scanId)}`, { timeoutMs: 8000 }, { error: 'Status unavailable' });

export const getSettings = async () =>
    apiJsonSafe('/settings', { timeoutMs: 8000 }, { error: 'Failed to fetch settings' });

export const getMyIP = async (useProxy = false) =>
    apiJsonSafe(`/my-ip?proxy=${useProxy ? '1' : '0'}`, { timeoutMs: 10000 }, { error: 'Failed to fetch IP details' });

export const getSmartRecommendations = async (isp = '', location = '', country = '', limit = 30) =>
    apiJsonSafe('/api/smart-recommend', {
        method: 'POST',
        body: JSON.stringify({ isp, location, country, limit }),
    }, { results: [], total: 0 });

export const getBestCommunityBypasses = async (isp, mode = 'fragment', limit = 5) =>
    apiJsonSafe(`/api/best-bypasses?isp=${encodeURIComponent(isp)}&mode=${mode}&limit=${limit}`, {}, { results: [] });

export const saveSettings = async (settings) => {
    try {
        await apiFetch('/settings', { method: 'POST', body: JSON.stringify(settings) });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
};

export const getExportLink = async (vlessConfig, ips) =>
    apiJsonSafe('/export-link', {
        method: 'POST',
        body: JSON.stringify({ format: 'base64', vless_config: vlessConfig, ips }),
    }, { error: 'Failed to create export link' });

export const fetchConfigFromUrl = async (url, useProxy = false) =>
    apiJsonSafe(`/fetch-config?proxy=${useProxy ? '1' : '0'}`, {
        method: 'POST',
        body: JSON.stringify({ url }),
        timeoutMs: 60000,
    }, { error: 'Failed to fetch config' });

export const logUsage = async (event_type, details = '') => {
    try {
        await apiFetch('/log-usage', {
            method: 'POST',
            body: JSON.stringify({ event_type, details }),
            timeoutMs: 5000,
        });
    } catch (_) { /* fire-and-forget */ }
};

export const getHealth = async () =>
    apiJsonSafe('/health', { timeoutMs: 5000 }, { internet: 'offline', database: 'offline' });

export const proxyDatabase = async (vlessConfig) =>
    apiJsonSafe('/proxy-db', {
        method: 'POST',
        body: JSON.stringify({ vless_config: vlessConfig }),
        timeoutMs: 60000,
    }, { status: 'error', message: 'Network error' });

export const getAnalytics = async (provider = 'cloudflare') =>
    apiJsonSafe(`/analytics?provider=${encodeURIComponent(provider)}`, {}, { error: 'Failed to fetch analytics' });

export const getGeoAnalytics = async (provider = 'cloudflare') =>
    apiJsonSafe(`/analytics/geo?provider=${encodeURIComponent(provider)}`, {}, { error: 'Failed to fetch geo analytics' });

export const getGamificationStatus = async () =>
    apiJsonSafe('/api/gamification/status', {
        headers: { 'X-Client-ID': getClientId() },
    }, { success: false, total_scans: 0, recent_scans: 0, has_scanned_recently: false, vip_unlocked: false });

export const getFreeConfigs = async () =>
    apiJsonSafe('/api/free-configs', {}, { success: false, configs: [] });

export const startMixAndTest = async () =>
    apiPostSafe('/api/community/mix-and-test', {});

export const getMixTestStatus = async (jobId) =>
    apiJsonSafe(`/api/community/mix-status/${encodeURIComponent(jobId)}`, {},
        { success: false, done: true, error: 'Connection failed' });

export const ADMIN_PANEL_URL =
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ADMIN_PANEL_URL) || '';

export const testConfigRemote = async (configString) => {
    try {
        const data = await apiJson('/test-config', {
            method: 'POST',
            body: JSON.stringify({ config: configString }),
            timeoutMs: 60000,
        });
        return { success: data.ok, error: data.ok ? null : data.message, message: data.message, result: data.result || null };
    } catch (e) {
        if (e.timeout) {
            return { success: false, error: 'Test timed out after 60 seconds. The config may be too slow or unreachable.' };
        }
        return { success: false, error: e.message || 'Could not reach the test server.' };
    }
};

export const scanAdvancedIPs = async (payload) => apiJsonSafe('/scan-advanced', {
    method: 'POST',
    headers: { 'X-Client-ID': getClientId() },
    body: JSON.stringify(payload),
}, { error: 'Failed to start advanced scan' });

export async function scanWarpIPs(data) {
    return apiJsonSafe('/scan-warp', { method: 'POST', body: JSON.stringify(data) }, { error: 'Failed to start scan' });
}

export async function getWarpScanStatus(scanId) {
    return apiJsonSafe(`/scan-warp/${encodeURIComponent(scanId)}`, { timeoutMs: 8000 }, { error: 'Status unavailable' });
}

export async function stopWarpScan(scanId) {
    return apiPostSafe(`/scan-warp/${encodeURIComponent(scanId)}/stop`, {});
}

export async function pauseScan(scanId) {
    return apiPostSafe(`/scan/${encodeURIComponent(scanId)}/pause`, {});
}

export async function resumeScan(scanId) {
    return apiPostSafe(`/scan/${encodeURIComponent(scanId)}/resume`, {});
}

export async function stopScan(scanId) {
    return apiPostSafe(`/scan/${encodeURIComponent(scanId)}/stop`, {});
}

export const exportDatabase = async ({ sections, passphrase, scanLimit } = {}) => {
    const params = new URLSearchParams();
    if (sections && sections.length) params.set('sections', Array.isArray(sections) ? sections.join(',') : sections);
    if (passphrase) params.set('passphrase', passphrase);
    if (scanLimit) params.set('scan_limit', String(scanLimit));
    const qs = params.toString();
    const res = await apiFetch(`/api/db-export${qs ? `?${qs}` : ''}`, { timeoutMs: 120000 });
    return res.blob();
};

export const importDatabase = async (file, { passphrase, sections, dryRun } = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    const params = new URLSearchParams();
    if (passphrase) params.set('passphrase', passphrase);
    if (sections && sections.length) params.set('sections', Array.isArray(sections) ? sections.join(',') : sections);
    if (dryRun) params.set('dry_run', 'true');
    const qs = params.toString();
    return apiJsonSafe(`/api/db-import${qs ? `?${qs}` : ''}`, { method: 'POST', body: formData, timeoutMs: 120000 }, { error: 'Import failed' });
};

export const previewBackup = async (file, { passphrase } = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    const params = new URLSearchParams();
    if (passphrase) params.set('passphrase', passphrase);
    const qs = params.toString();
    return apiJsonSafe(`/api/data/preview${qs ? `?${qs}` : ''}`, { method: 'POST', body: formData, timeoutMs: 60000 }, { error: 'Preview failed' });
};

export const listBackupSections = async () =>
    apiJsonSafe('/api/data/sections', { timeoutMs: 8000 }, { error: 'Sections unavailable' });

export const listSnapshots = async () =>
    apiJsonSafe('/api/data/snapshots', { timeoutMs: 10000 }, { error: 'Snapshots unavailable' });

export const createSnapshot = async (payload = {}) =>
    apiPostSafe('/api/data/snapshots/create', payload, { timeoutMs: 120000 });

export const downloadSnapshot = async (name) => {
    const res = await apiFetch(`/api/data/snapshots/download?name=${encodeURIComponent(name)}`, { timeoutMs: 60000 });
    return res.blob();
};

export const deleteSnapshot = async (name) => {
    const res = await apiFetch(`/api/data/snapshots?name=${encodeURIComponent(name)}`, { method: 'DELETE', timeoutMs: 10000 });
    return res.json();
};

export const importHistory = async () =>
    apiJsonSafe('/api/data/history', { timeoutMs: 10000 }, { error: 'History unavailable' });

export const startFreedom = async () => apiPostSafe('/api/freedom/start', {});
export const stopFreedom = async () => apiPostSafe('/api/freedom/stop', {});
export const getFreedomStatus = async () => apiJsonSafe('/api/freedom/status', { timeoutMs: 8000 }, { error: 'Status unavailable' });
export const provideFreedomConfig = async (config) =>
    apiPostSafe('/api/freedom/provide-config', { config });

// ==========================================
// DNS TUNNEL WIZARD API
// ==========================================

export const tunnelConnect = async (host, port, username, password, privateKey) => {
    const cleanHost = (host || '').toString().trim();
    const cleanPort = Number.parseInt(port, 10);
    const cleanUser = (username || '').toString().trim() || 'root';
    if (!cleanHost) {
        return { success: false, message: 'Host is required' };
    }
    return apiPostSafe('/api/tunnel/connect', {
        host: cleanHost,
        port: Number.isFinite(cleanPort) && cleanPort > 0 ? cleanPort : 22,
        username: cleanUser,
        password: password || null,
        private_key: privateKey || null,
    }, { timeoutMs: 30000 });
};

export const tunnelDisconnect = async () => apiPostSafe('/api/tunnel/disconnect', {});
export const tunnelPreflight = async () => apiPostSafe('/api/tunnel/preflight', {}, { timeoutMs: 60000 });
export const tunnelFixPort53 = async () => apiPostSafe('/api/tunnel/fix-port53', {}, { timeoutMs: 60000 });

export const tunnelVerifyDns = async (domain, serverIp) =>
    apiPostSafe('/api/tunnel/verify-dns', { domain, server_ip: serverIp }, { timeoutMs: 30000 });

export const tunnelCloudflareDns = async (apiToken, domain, serverIp) =>
    apiPostSafe('/api/tunnel/cloudflare-dns', { api_token: apiToken, domain, server_ip: serverIp }, { timeoutMs: 30000 });

export const tunnelDeploy = async (config) =>
    apiPostSafe('/api/tunnel/deploy', config, { timeoutMs: 60000 });

export const tunnelDeployStatus = async () =>
    apiJsonSafe('/api/tunnel/deploy/status', { timeoutMs: 8000 }, { error: 'Status unavailable' });

export const tunnelDeployCancel = async () => apiPostSafe('/api/tunnel/deploy/cancel', {});

export const tunnelGetConfigs = async () =>
    apiJsonSafe('/api/tunnel/configs', {}, { error: 'Failed to fetch configs' });

// --- Phase 2: Manage existing deployment ---
export const tunnelManageStatus = async () =>
    apiJsonSafe('/api/tunnel/manage/status', { timeoutMs: 10000 }, { error: 'Status unavailable' });
export const tunnelManageRestart = async () => apiPostSafe('/api/tunnel/manage/restart', {}, { timeoutMs: 30000 });
export const tunnelManageUsersList = async () =>
    apiJsonSafe('/api/tunnel/manage/users', {}, { error: 'Failed to fetch users' });
export const tunnelManageUserAdd = async (username, password) =>
    apiPostSafe('/api/tunnel/manage/users/add', { username, password });
export const tunnelManageUserRemove = async (username) =>
    apiPostSafe('/api/tunnel/manage/users/remove', { username });
export const tunnelManageUpdate = async () => apiPostSafe('/api/tunnel/manage/update', {}, { timeoutMs: 60000 });
export const tunnelManageUninstall = async () => apiPostSafe('/api/tunnel/manage/uninstall', {}, { timeoutMs: 60000 });

// --- Phase 3: Resolver scanner ---
export const tunnelScanResolvers = async (domain, top_n = 10, timeout_s = 2.5) =>
    apiPostSafe('/api/tunnel/scan-resolvers', { domain, top_n, timeout_s }, { timeoutMs: 60000 });

// --- Phase 4: Add-on protocols + live metrics ---
export const tunnelInstallNaive = async (domain, username, password) =>
    apiPostSafe('/api/tunnel/addon/naive/install', { domain, username, password }, { timeoutMs: 120000 });
export const tunnelInstallStunTls = async (listen_port = 443, ssh_port = 22) =>
    apiPostSafe('/api/tunnel/addon/stuntls/install', { listen_port, ssh_port }, { timeoutMs: 120000 });
export const tunnelToggleWarp = async (enable) =>
    apiPostSafe('/api/tunnel/addon/warp', { enable }, { timeoutMs: 60000 });
export const tunnelLiveMetrics = async () =>
    apiJsonSafe('/api/tunnel/manage/metrics', { timeoutMs: 5000 }, { error: 'Metrics unavailable' });

export const tunnelHealth = async () => {
    try {
        return await apiJson('/api/tunnel/health', { timeoutMs: 5000 });
    } catch (e) {
        if (e.status) {
            return { ok: false, missing: [`HTTP ${e.status}`], reason: 'endpoint_unavailable' };
        }
        return { ok: false, missing: ['backend unreachable'], reason: 'network', error: e.message };
    }
};

// ==========================================
// DNS RESOLVER SCANNER API
// ==========================================

export const dnsStartScan = async (config) =>
    apiPostSafe('/api/dns-scan/start', config);

export const dnsGetScanStatus = async (scanId) =>
    apiJsonSafe(`/api/dns-scan/${encodeURIComponent(scanId)}/status`, { timeoutMs: 8000 }, { error: 'Status unavailable' });

export const dnsStopScan = async (scanId) =>
    apiPostSafe(`/api/dns-scan/${encodeURIComponent(scanId)}/stop`, {});

export const dnsQuickTest = async (resolver, domain, opts = {}) =>
    apiPostSafe('/api/dns-scan/quick-test', {
        resolver,
        domain,
        protocol: opts.protocol || 'udp',
        utls_fingerprint: opts.utls_fingerprint || null,
    }, { timeoutMs: 30000 });

export const dnsE2ETest = async (resolver, opts = {}) =>
    apiPostSafe('/api/dns-scan/e2e-test', {
        resolver,
        domain: opts.domain || 'www.cloudflare.com',
        target_url: opts.target_url || 'https://www.cloudflare.com/cdn-cgi/trace',
        timeout_ms: opts.timeout_ms || 8000,
        protocol: opts.protocol || 'udp',
    }, { timeoutMs: 30000 });

export const dnsBestConfig = async (scanId, domain, pubkey) =>
    apiPostSafe('/api/dns-scan/best-config', { scan_id: scanId, domain, pubkey });

export const dnsGetResolvers = async () =>
    apiJsonSafe('/api/dns-scan/resolvers', {}, { error: 'Failed to fetch resolvers' });

export const dnsExportScan = async (scanId, fmt = 'json') => {
    try {
        const res = await apiFetch(`/api/dns-scan/${encodeURIComponent(scanId)}/export?fmt=${encodeURIComponent(fmt)}`);
        return fmt === 'csv' ? res.text() : res.json();
    } catch (e) {
        return fmt === 'csv' ? '' : { error: e.message };
    }
};

export const dnsRetestTop = async (scanId, topN = 10, rounds = 10) =>
    apiPostSafe(
        `/api/dns-scan/${encodeURIComponent(scanId)}/retest-top?top_n=${topN}&rounds=${rounds}`,
        {},
        { timeoutMs: 120000 }
    );

export const dnsGetHistory = async () =>
    apiJsonSafe('/api/dns-scan/history', {}, { error: 'Failed to fetch history' });

export const dnsGenerateConfig = async (resolver, domain, tunnelType = 'auto', pubkey = null) =>
    apiPostSafe('/api/dns-scan/generate-config', { resolver, domain, tunnel_type: tunnelType, pubkey });

export const dnsPredictBest = async () =>
    apiJsonSafe('/api/dns-scan/predict-best', {}, { error: 'Failed to predict' });

// ==========================================
// SPEED MATRIX (config × DNS × transport)
// ==========================================

export const speedMatrixStart = async ({ configs, resolvers, transports, target_url, timeout_ms } = {}) =>
    apiPostSafe('/api/speed-matrix/start', { configs, resolvers, transports, target_url, timeout_ms });

export const speedMatrixStatus = async (scanId) =>
    apiJsonSafe(`/api/speed-matrix/${encodeURIComponent(scanId)}/status`, { timeoutMs: 8000 }, { error: 'Status unavailable' });

export const speedMatrixStop = async (scanId) =>
    apiPostSafe(`/api/speed-matrix/${encodeURIComponent(scanId)}/stop`, {});
