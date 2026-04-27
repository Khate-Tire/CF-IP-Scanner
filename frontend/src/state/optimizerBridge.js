/* Copyright (c) 2026 Khate Tire */
// Tiny pub/sub bridge that lets DNS Optimizer, Config Lab, and Deploy Wizard
// share data without prop-drilling or pulling in a state library.
//
// Payload shape (all fields optional):
//   {
//     source: 'optimizer' | 'lab',
//     resolvers: ['1.1.1.1', ...],     // candidate IPs to pre-load
//     winner: { resolver, transport, latency, score, host },
//     host: 'tunnel.example.com',       // the host to validate against
//     domain: 'tunnel.example.com',     // domain to seed Deploy Wizard with
//     transport: 'udp'|'tcp'|'tls'|'https'|'sweep',
//     mode: 'dnstt'|'noizdns'|'vaydns'|'slipstream'|'auto',
//     timestamp: 1714000000000,
//   }

const STORAGE_KEY = 'optimizer_bridge_payload_v1';

let _payload = null;
const _listeners = new Set();

try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) _payload = JSON.parse(raw);
} catch { /* ignore */ }

function _persist() {
    try {
        if (_payload) localStorage.setItem(STORAGE_KEY, JSON.stringify(_payload));
        else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}

function _notify() {
    for (const fn of _listeners) {
        try { fn(_payload); } catch { /* ignore */ }
    }
}

export function setBridgePayload(payload) {
    _payload = payload ? { ...payload, timestamp: Date.now() } : null;
    _persist();
    _notify();
}

export function getBridgePayload() {
    return _payload;
}

export function clearBridgePayload() {
    _payload = null;
    _persist();
    _notify();
}

export function subscribeBridge(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

// Convenience helpers used by components.
export function sendToConfigLab({ resolvers, winner, host, domain, transport, mode }) {
    setBridgePayload({
        source: 'optimizer',
        resolvers: Array.isArray(resolvers) ? resolvers.filter(Boolean) : [],
        winner: winner || null,
        host: host || domain || null,
        domain: domain || host || null,
        transport: transport || 'sweep',
        mode: mode || 'auto',
    });
}

export function sendToDeployWizard({ winner, host, domain, transport, mode, resolvers }) {
    setBridgePayload({
        source: 'lab',
        resolvers: Array.isArray(resolvers) ? resolvers.filter(Boolean) : [],
        winner: winner || null,
        host: host || domain || null,
        domain: domain || host || null,
        transport: transport || null,
        mode: mode || null,
    });
}
