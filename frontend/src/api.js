export const API_URL = "http://127.0.0.1:8000";

export const scanIPs = async (config) => {
    const response = await fetch(`${API_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
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
    return null;
};

export const getMyIP = async () => {
    try {
        const response = await fetch(`${API_URL}/my-ip`);
        if (response.ok) return response.json();
    } catch (e) { console.error(e); }
    return null;
};

export const saveSettings = async (settings) => {
    try {
        await fetch(`${API_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
    } catch (e) { console.error(e); }
};

export const fetchConfigFromUrl = async (url) => {
    try {
        const response = await fetch(`${API_URL}/fetch-config`, {
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

export const getAnalytics = async () => {
    try {
        const response = await fetch(`${API_URL}/analytics`);
        if (response.ok) return response.json();
    } catch (e) { console.error(e); }
    return null;
};

export const scanAdvancedIPs = async (payload) => {
    const response = await fetch(`${API_URL}/scan-advanced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return response.json();
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
