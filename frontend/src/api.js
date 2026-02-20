export const API_URL = "http://localhost:8000";

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
