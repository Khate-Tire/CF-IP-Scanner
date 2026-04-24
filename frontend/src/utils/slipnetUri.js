/* Copyright (c) 2026 Taher AkbariSaeed */
// slipnet:// URI parser & encoder.
// Compatible with the SlipNet Android app and dnstm-setup share URIs.
// Format: slipnet://BASE64URL(JSON_OR_QUERY_STRING)
//
// Common fields (best-effort — different generators include different keys):
//   name, domain, resolver, mode (dnstt|noizdns|vaydns|slipstream|ssh)
//   pubkey (hex), authMode (0|1), socksUser, socksPass
//   sshHost, sshPort, sshUser, sshPass
//   sshTlsEnabled, sshTlsSni
//   sshWsEnabled, sshWsPath, sshWsUseTls, sshWsHost
//   sshHttpProxyHost, sshHttpProxyPort, sshHttpProxyHostHeader
//   sshPayload
//   recordType, maxQname, rps, clientIdSize, idleTimeout, keepAlive, udpTimeout, maxDataLabels
//   maxQuerySize, queryPadding, dohUrl, utlsFingerprint
//   direct, dnsTransport (udp|tcp|dot|doh), stealth

const STRIP = (s) => (s || '').trim();

function b64urlDecode(input) {
    let s = STRIP(input).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try {
        const bin = atob(s);
        // Try UTF-8 decode (may contain Cyrillic / Persian profile names)
        try {
            return decodeURIComponent(escape(bin));
        } catch {
            return bin;
        }
    } catch {
        return null;
    }
}

function b64urlEncode(str) {
    let s;
    try {
        s = btoa(unescape(encodeURIComponent(str)));
    } catch {
        s = btoa(str);
    }
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Parse a slipnet://... or generic config:// URI into a flat object. Returns null on failure. */
export function parseSlipnetUri(uri) {
    if (!uri) return null;
    const m = STRIP(uri).match(/^([a-z0-9-]+):\/\/(.+)$/i);
    if (!m) return null;
    const [, scheme, rest] = m;
    if (!/^slipnet|slipnet-enc|dnst|noiz|vay$/i.test(scheme)) return null;

    // Strip any fragment / query that follows the BASE64
    const payload = rest.split('#')[0];
    const decoded = b64urlDecode(payload);
    if (!decoded) return null;

    // Try JSON
    try {
        const obj = JSON.parse(decoded);
        if (obj && typeof obj === 'object') return { _scheme: scheme, ...flatten(obj) };
    } catch { /* fall through */ }

    // Try URL-encoded query string (k=v&k=v)
    if (/[=&]/.test(decoded)) {
        const out = { _scheme: scheme };
        for (const part of decoded.split('&')) {
            const [k, ...v] = part.split('=');
            if (!k) continue;
            try { out[decodeURIComponent(k)] = decodeURIComponent(v.join('=')); }
            catch { out[k] = v.join('='); }
        }
        return out;
    }

    return { _scheme: scheme, _raw: decoded };
}

function flatten(obj, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
        else out[key] = v;
    }
    return out;
}

/** Encode a flat object back into a slipnet://BASE64 URI. */
export function encodeSlipnetUri(fields, scheme = 'slipnet') {
    const clean = { ...fields };
    delete clean._scheme;
    delete clean._raw;
    const json = JSON.stringify(clean);
    return `${scheme}://${b64urlEncode(json)}`;
}

/** Map common field aliases into our normalized config shape. */
export function normalize(fields) {
    if (!fields) return null;
    const f = fields;
    const pick = (...keys) => {
        for (const k of keys) {
            if (f[k] != null && f[k] !== '') return f[k];
        }
        return undefined;
    };
    return {
        name: pick('name', 'profileName', 'remarks'),
        domain: pick('domain', 'd', 'host'),
        resolver: pick('resolver', 'dns', 'r'),
        mode: pick('mode', 'tunnelType', 'transport', 'protocol'),
        pubkey: pick('pubkey', 'publicKey', 'pub'),
        authMode: pick('authMode'),
        socksUser: pick('socksUser', 'user', 'username'),
        socksPass: pick('socksPass', 'pass', 'password'),
        sshHost: pick('sshHost'),
        sshPort: pick('sshPort'),
        sshUser: pick('sshUser'),
        sshPass: pick('sshPass'),
        sshTlsEnabled: pick('sshTlsEnabled'),
        sshTlsSni: pick('sshTlsSni'),
        sshWsEnabled: pick('sshWsEnabled'),
        sshWsPath: pick('sshWsPath'),
        sshWsUseTls: pick('sshWsUseTls'),
        sshWsHost: pick('sshWsHost'),
        sshHttpProxyHost: pick('sshHttpProxyHost'),
        sshHttpProxyPort: pick('sshHttpProxyPort'),
        sshHttpProxyHostHeader: pick('sshHttpProxyHostHeader'),
        sshPayload: pick('sshPayload'),
        recordType: pick('recordType', 'rtype'),
        maxQname: pick('maxQname', 'maxQnameLength'),
        rps: pick('rps', 'rateLimit'),
        clientIdSize: pick('clientIdSize'),
        idleTimeout: pick('idleTimeout'),
        keepAlive: pick('keepAlive'),
        udpTimeout: pick('udpTimeout'),
        maxDataLabels: pick('maxDataLabels'),
        maxQuerySize: pick('maxQuerySize'),
        queryPadding: pick('queryPadding'),
        dohUrl: pick('dohUrl'),
        utlsFingerprint: pick('utlsFingerprint', 'utls'),
        direct: pick('direct'),
        dnsTransport: pick('dnsTransport'),
        stealth: pick('stealth'),
        _scheme: f._scheme,
        _raw: f._raw,
    };
}
