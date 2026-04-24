/* Copyright (c) 2026 Taher AkbariSaeed */
import { getClientId } from './utils/clientId';
export const API_URL = "http://127.0.0.1:8000";

export const scanIPs = async (config) => {
    const cid = getClientId();

    const response = await fetch(`${API_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-ID': cid },
        body: JSON.stringify(config)
    });
    return response.json();
};

export const rescanIP = async (vlessConfig, ip) => {
    const response = await fetch(`${API_URL}/rescan-ip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vless_config: vlessConfig, ip })
    });
    return response.json();
};

export const exportSubscription = async (format, vlessConfig, ips) => {
    const response = await fetch(`${API_URL}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, vless_config: vlessConfig, ips })
    });
    return response.json();
};

export const getScanStatus = async (scanId) => {
    const response = await fetch(`${API_URL}/scan/${scanId}`);
    return response.json();
};

export const getSettings = async () => {
    try {
        const response = await fetch(`${API_URL}/settings`);
        if (response.ok) return response.json();
    } catch (e) { console.error(e); }
    return { error: 'Failed to fetch settings' };
};

export const getMyIP = async (useProxy = false) => {
    try {
        const response = await fetch(`${API_URL}/my-ip?proxy=${useProxy ? '1' : '0'}`);
        if (response.ok) return response.json();
    } catch (e) { console.error(e); }
    return { error: 'Failed to fetch IP details' };
};

export const getSmartRecommendations = async (isp = '', location = '', country = '', limit = 30) => {
    try {
        const response = await fetch(`${API_URL}/api/smart-recommend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isp, location, country, limit })
        });
        if (response.ok) return response.json();
    } catch (e) { console.error(e); }
    return { results: [], total: 0 };
};

export const getBestCommunityBypasses = async (isp, mode = 'fragment', limit = 5) => {
    try {
        const response = await fetch(`${API_URL}/api/best-bypasses?isp=${encodeURIComponent(isp)}&mode=${mode}&limit=${limit}`);
        if (response.ok) return response.json();
    } catch (e) { console.error(e); }
    return { results: [] };
};

export const saveSettings = async (settings) => {
    try {
        await fetch(`${API_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        return { success: true };
    } catch (e) {
        console.error(e);
        return { error: "Network error" };
    }
};

export const getExportLink = async (vlessConfig, ips) => {
    try {
        const response = await fetch(`${API_URL}/export-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format: 'base64', vless_config: vlessConfig, ips: ips })
        });
        if (response.ok) return await response.json();
    } catch (e) { console.error(e); }
    return { error: 'Failed to create export link' };
};

export const fetchConfigFromUrl = async (url, useProxy = false) => {
    try {
        const response = await fetch(`${API_URL}/fetch-config?proxy=${useProxy ? '1' : '0'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        return await response.json();
    } catch (e) {
        return { error: e.message };
    }
};

export const logUsage = async (event_type, details = "") => {
    try {
        await fetch(`${API_URL}/log-usage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_type, details })
        });
    } catch (e) { console.error(e); }
};

export const getHealth = async () => {
    try {
        const response = await fetch(`${API_URL}/health`);
        return await response.json();
    } catch (e) {
        return { internet: 'offline', database: 'offline' };
    }
};

export const proxyDatabase = async (vlessConfig) => {
    try {
        const response = await fetch(`${API_URL}/proxy-db`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vless_config: vlessConfig })
        });
        return await response.json();
    } catch (e) {
        return { status: 'error', message: e.message };
    }
};

export const getAnalytics = async (provider = 'cloudflare') => {
    try {
        const response = await fetch(`${API_URL}/analytics?provider=${provider}`);
        if (response.ok) return response.json();
    } catch (e) { console.error(e); }
    return { error: 'Failed to fetch analytics' };
};

export const getGeoAnalytics = async (provider = 'cloudflare') => {
    try {
        const response = await fetch(`${API_URL}/analytics/geo?provider=${provider}`);
        if (response.ok) return response.json();
    } catch (e) { console.error(e); }
    return { error: 'Failed to fetch geo analytics' };
};

export const getGamificationStatus = async () => {
    try {
        const cid = getClientId();

        const response = await fetch(`${API_URL}/api/gamification/status`, {
            headers: { 'X-Client-ID': cid }
        });
        if (response.ok) return await response.json();
    } catch (e) { console.error(e); }
    return { success: false, total_scans: 0, recent_scans: 0, has_scanned_recently: false, vip_unlocked: false };
};

export const getFreeConfigs = async () => {
    try {
        const response = await fetch(`${API_URL}/api/free-configs`);
        if (response.ok) return await response.json();
    } catch (e) { console.error(e); }
    return { success: false, configs: [] };
};

export const startMixAndTest = async () => {
    try {
        const response = await fetch(`${API_URL}/api/community/mix-and-test`, { method: 'POST' });
        if (response.ok) return await response.json();
    } catch (e) { console.error(e); }
    return { success: false };
};

export const getMixTestStatus = async (jobId) => {
    try {
        const response = await fetch(`${API_URL}/api/community/mix-status/${jobId}`);
        if (response.ok) return await response.json();
    } catch (e) { console.error(e); }
    return { success: false, done: true, error: 'Connection failed' };
};

const ADMIN_PANEL_URL = import.meta.env.VITE_ADMIN_PANEL_URL || '';

export const testConfigRemote = async (configString) => {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const response = await fetch(`${API_URL}/test-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: configString }),
            signal: controller.signal
        });
        clearTimeout(timeout);
        const data = await response.json();
        return { success: data.ok, error: data.ok ? null : data.message, message: data.message, result: data.result || null };
    } catch (e) {
        if (e.name === 'AbortError') {
            return { success: false, error: 'Test timed out after 60 seconds. The config may be too slow or unreachable.' };
        }
        return { success: false, error: 'Could not reach the test server. Please try again later.' };
    }
};

export const scanAdvancedIPs = async (payload) => {
    try {
        const cid = getClientId();

        const response = await fetch(`${API_URL}/scan-advanced`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client-ID': cid },
            body: JSON.stringify(payload)
        });
        return response.json();
    } catch (e) {
        return { error: e.message };
    }
};

export async function scanWarpIPs(data) {
    const res = await fetch(`${API_URL}/scan-warp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

export async function getWarpScanStatus(scanId) {
    const res = await fetch(`${API_URL}/scan-warp/${scanId}`);
    return res.json();
}

export async function stopWarpScan(scanId) {
    const res = await fetch(`${API_URL}/scan-warp/${scanId}/stop`, { method: 'POST' });
    return res.json();
}

export async function pauseScan(scanId) {
    const res = await fetch(`${API_URL}/scan/${scanId}/pause`, { method: 'POST' });
    return res.json();
}

export async function resumeScan(scanId) {
    const res = await fetch(`${API_URL}/scan/${scanId}/resume`, { method: 'POST' });
    return res.json();
}

export async function stopScan(scanId) {
    const res = await fetch(`${API_URL}/scan/${scanId}/stop`, { method: 'POST' });
    return res.json();
}

export const exportDatabase = async () => {
    const response = await fetch(`${API_URL}/api/db-export`, {
        method: 'GET',
    });
    if (!response.ok) throw new Error("Failed to export DB");
    return response.blob();
};

export const importDatabase = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_URL}/api/db-import`, {
        method: 'POST',
        body: formData
    });
    return response.json();
};

export const startFreedom = async () => {
    const res = await fetch(`${API_URL}/api/freedom/start`, { method: 'POST' });
    return res.json();
};

export const stopFreedom = async () => {
    const res = await fetch(`${API_URL}/api/freedom/stop`, { method: 'POST' });
    return res.json();
};

export const getFreedomStatus = async () => {
    const res = await fetch(`${API_URL}/api/freedom/status`, { method: 'GET' });
    return res.json();
};

export const provideFreedomConfig = async (config) => {
    const res = await fetch(`${API_URL}/api/freedom/provide-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
    });
    return res.json();
};

// ==========================================
// DNS TUNNEL WIZARD API
// ==========================================

export const tunnelConnect = async (host, port, username, password, privateKey) => {
    const res = await fetch(`${API_URL}/api/tunnel/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, username, password, private_key: privateKey })
    });
    return res.json();
};

export const tunnelDisconnect = async () => {
    const res = await fetch(`${API_URL}/api/tunnel/disconnect`, { method: 'POST' });
    return res.json();
};

export const tunnelPreflight = async () => {
    const res = await fetch(`${API_URL}/api/tunnel/preflight`, { method: 'POST' });
    return res.json();
};

export const tunnelVerifyDns = async (domain, serverIp) => {
    const res = await fetch(`${API_URL}/api/tunnel/verify-dns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, server_ip: serverIp })
    });
    return res.json();
};

export const tunnelCloudflareDns = async (apiToken, domain, serverIp) => {
    const res = await fetch(`${API_URL}/api/tunnel/cloudflare-dns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_token: apiToken, domain, server_ip: serverIp })
    });
    return res.json();
};

export const tunnelDeploy = async (config) => {
    const res = await fetch(`${API_URL}/api/tunnel/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    return res.json();
};

export const tunnelDeployStatus = async () => {
    const res = await fetch(`${API_URL}/api/tunnel/deploy/status`);
    return res.json();
};

export const tunnelDeployCancel = async () => {
    const res = await fetch(`${API_URL}/api/tunnel/deploy/cancel`, { method: 'POST' });
    return res.json();
};

export const tunnelGetConfigs = async () => {
    const res = await fetch(`${API_URL}/api/tunnel/configs`);
    return res.json();
};

// ==========================================
// DNS RESOLVER SCANNER API
// ==========================================

export const dnsStartScan = async (config) => {
    const res = await fetch(`${API_URL}/api/dns-scan/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    return res.json();
};

export const dnsGetScanStatus = async (scanId) => {
    const res = await fetch(`${API_URL}/api/dns-scan/${scanId}/status`);
    return res.json();
};

export const dnsStopScan = async (scanId) => {
    const res = await fetch(`${API_URL}/api/dns-scan/${scanId}/stop`, { method: 'POST' });
    return res.json();
};

export const dnsQuickTest = async (resolver, domain, opts = {}) => {
    const res = await fetch(`${API_URL}/api/dns-scan/quick-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolver, domain, protocol: opts.protocol || 'udp', utls_fingerprint: opts.utls_fingerprint || null })
    });
    return res.json();
};

export const dnsE2ETest = async (resolver, opts = {}) => {
    const res = await fetch(`${API_URL}/api/dns-scan/e2e-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            resolver,
            domain: opts.domain || 'www.cloudflare.com',
            target_url: opts.target_url || 'https://www.cloudflare.com/cdn-cgi/trace',
            timeout_ms: opts.timeout_ms || 8000,
            protocol: opts.protocol || 'udp',
        })
    });
    return res.json();
};

export const dnsBestConfig = async (scanId, domain, pubkey) => {
    const res = await fetch(`${API_URL}/api/dns-scan/best-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_id: scanId, domain, pubkey })
    });
    return res.json();
};

export const dnsGetResolvers = async () => {
    const res = await fetch(`${API_URL}/api/dns-scan/resolvers`);
    return res.json();
};

export const dnsExportScan = async (scanId, fmt = 'json') => {
    const res = await fetch(`${API_URL}/api/dns-scan/${scanId}/export?fmt=${fmt}`);
    if (fmt === 'csv') return res.text();
    return res.json();
};

export const dnsRetestTop = async (scanId, topN = 10, rounds = 10) => {
    const res = await fetch(`${API_URL}/api/dns-scan/${scanId}/retest-top?top_n=${topN}&rounds=${rounds}`, { method: 'POST' });
    return res.json();
};

export const dnsGetHistory = async () => {
    const res = await fetch(`${API_URL}/api/dns-scan/history`);
    return res.json();
};

export const dnsGenerateConfig = async (resolver, domain, tunnelType = 'auto', pubkey = null) => {
    const res = await fetch(`${API_URL}/api/dns-scan/generate-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolver, domain, tunnel_type: tunnelType, pubkey })
    });
    return res.json();
};

export const dnsPredictBest = async () => {
    const res = await fetch(`${API_URL}/api/dns-scan/predict-best`);
    return res.json();
};

