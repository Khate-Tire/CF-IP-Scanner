/* Copyright (c) 2026 Taher AkbariSaeed */
export const API_URL = "http://127.0.0.1:8000";

export const scanIPs = async (config) => {
    const response = await fetch(`${API_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
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

export const scanAdvancedIPs = async (payload) => {
    try {
        const response = await fetch(`${API_URL}/scan-advanced`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
