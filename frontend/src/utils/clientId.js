/* Copyright (c) 2026 Taher AkbariSaeed */
// Centralized client identifier — generated once and persisted forever in localStorage.
const KEY = 'app_client_id';

export function getClientId() {
    try {
        let cid = localStorage.getItem(KEY) || '';
        if (!cid) {
            cid = Math.random().toString(36).substring(2) + Date.now().toString(36);
            localStorage.setItem(KEY, cid);
        }
        return cid;
    } catch (_e) {
        void _e;
        // localStorage unavailable (e.g. SSR / private mode) — fall back to ephemeral id
        return 'anon-' + Date.now().toString(36);
    }
}
