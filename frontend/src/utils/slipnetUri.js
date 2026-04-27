/* Copyright (c) 2026 Khate Tire */
// slipnet:// URI parser & encoder.
// Compatible with the SlipNet Android app, SlipNet CLI, and dnstm-setup.
//
// Real on-the-wire format used by SlipNet (cli/main.go: parseURI):
//   slipnet://BASE64STD(PIPE_DELIMITED_FIELDS)
//   slipnet-enc://BASE64STD(AES-256-GCM([0x01][12-byte IV][ciphertext+tag]))
//
// PIPE format positional fields (verified against anonvector/SlipNet cli/main.go):
//   0: version          1: tunnelType ("dnstt"|"sayedns"|"vaydns"|"ssh"|"socks5"|"vless"|"doh"|...)
//   2: name             3: domain        4: resolvers (e.g. "8.8.8.8:53:0,1.1.1.1:53:0")
//   5: authMode (0/1)   6: keepAlive     7: cc (bbr|dcubic)
//   8: localPort        9: localHost    10: gso (0/1)        11: pubkey (hex)
//  12: socksUser       13: socksPass    14: sshEnabled (0/1) 15: sshUser
//  16: sshPass         17: sshPort      19: sshHost
//  21: dohUrl          22: dnsTransport (udp|tcp|tls|https)
//  31: isLocked (0/1)
//  38: noizdnsStealth (0/1)             39: dnsPayloadSize
//  41-49: VayDNS (dnsttCompat,recordType,maxQname,rps,idle,keepAlive,udpTimeout,maxLabels,clientIdSize)
//  50-51: sshTlsEnabled, sshTlsSni
//  52-54: sshHttpProxyHost, sshHttpProxyPort, sshHttpProxyCustomHost
//  55-58: sshWsEnabled, sshWsPath, sshWsUseTls, sshWsCustomHost
//  59:    sshPayload (base64-encoded inside the field)
//  60-61: resolverMode (fanout|roundrobin), rrSpreadCount
//  62-69: VLESS (uuid, wsPath, cdnIp, cdnPort, sniFragmentEnabled, sniFragmentStrategy, sniFragmentDelayMs, fakeSni)
//
// We ALSO accept legacy JSON / querystring payloads for forward compatibility.

const STRIP = (s) => (s || '').trim();

function b64decode(input) {
    // Try standard base64 first (SlipNet uses base64.StdEncoding), then base64url.
    const cleaned = STRIP(input).replace(/\s+/g, '');
    const candidates = [cleaned, cleaned.replace(/-/g, '+').replace(/_/g, '/')];
    for (let s of candidates) {
        while (s.length % 4) s += '=';
        try {
            return atob(s);
        } catch { /* try next */ }
    }
    return null;
}

function binToUtf8(bin) {
    if (bin == null) return null;
    try { return decodeURIComponent(escape(bin)); } catch { return bin; }
}

function b64urlEncode(str) {
    let s;
    try { s = btoa(unescape(encodeURIComponent(str))); }
    catch { s = btoa(str); }
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TUNNEL_TYPE_MAP = {
    dnstt: 'dnstt',
    dnstt_ssh: 'dnstt',
    sayedns: 'noizdns',
    sayedns_ssh: 'noizdns',
    vaydns: 'vaydns',
    vaydns_ssh: 'vaydns',
    ss: 'slipstream',
    slipstream: 'slipstream',
    slipstream_ssh: 'slipstream',
    ssh: 'ssh',
    direct_ssh: 'ssh',
    socks5: 'socks5',
    direct_socks: 'socks5',
    vless: 'vless',
    doh: 'doh',
    naive: 'naive',
};

function parsePipeFormat(decoded) {
    const f = decoded.split('|');
    if (f.length < 5) return null;
    const at = (i) => (i < f.length ? f[i] : '');
    const intAt = (i) => {
        const v = parseInt(at(i), 10);
        return Number.isFinite(v) ? v : undefined;
    };
    const floatAt = (i) => {
        const v = parseFloat(at(i));
        return Number.isFinite(v) ? v : undefined;
    };
    const boolAt = (i) => at(i) === '1';

    const resolversRaw = at(4);
    const resolverList = resolversRaw
        .split(',').map((r) => r.trim()).filter(Boolean)
        .map((r) => r.split(':')[0]).filter(Boolean);

    let sshPayload = '';
    if (f.length > 59 && at(59)) {
        const inner = b64decode(at(59));
        if (inner != null) sshPayload = binToUtf8(inner) || '';
    }

    const tunnelTypeRaw = at(1);
    return {
        _format: 'pipe',
        _version: at(0),
        tunnelTypeRaw,
        mode: TUNNEL_TYPE_MAP[tunnelTypeRaw] || tunnelTypeRaw || undefined,
        sshChained: /_ssh$/.test(tunnelTypeRaw),
        name: at(2),
        domain: at(3),
        resolvers: resolverList,
        resolver: resolverList[0],
        authMode: boolAt(5),
        keepAlive: intAt(6),
        cc: at(7),
        localPort: intAt(8),
        localHost: at(9),
        gso: boolAt(10),
        pubkey: at(11),
        socksUser: at(12),
        socksPass: at(13),
        sshEnabled: boolAt(14),
        sshUser: at(15),
        sshPass: at(16),
        sshPort: intAt(17),
        sshHost: at(19),
        dohUrl: at(21),
        dnsTransport: at(22),
        isLocked: boolAt(31),
        noizdnsStealth: boolAt(38),
        dnsPayloadSize: intAt(39),
        vaydnsDnsttCompat: boolAt(41),
        recordType: at(42),
        maxQname: intAt(43),
        rps: floatAt(44),
        idleTimeout: intAt(45),
        vaydnsKeepAlive: intAt(46),
        udpTimeout: intAt(47),
        maxDataLabels: intAt(48),
        clientIdSize: intAt(49),
        sshTlsEnabled: boolAt(50),
        sshTlsSni: at(51),
        sshHttpProxyHost: at(52),
        sshHttpProxyPort: intAt(53),
        sshHttpProxyHostHeader: at(54),
        sshWsEnabled: boolAt(55),
        sshWsPath: at(56),
        sshWsUseTls: boolAt(57),
        sshWsHost: at(58),
        sshPayload,
        resolverMode: at(60),
        rrSpreadCount: intAt(61),
        vlessUuid: at(62),
        vlessWsPath: at(63),
        vlessCdnIp: at(64),
        vlessCdnPort: intAt(65),
    };
}

/** Parse a slipnet://... or slipnet-enc://... URI. Returns:
 *   { ok: true, ...fields }                   on success
 *   { ok: false, encrypted: true, error }     for slipnet-enc:// (cannot decrypt)
 *   { ok: false, error }                      on other failures
 */
export function parseSlipnetUri(uri) {
    if (!uri) return { ok: false, error: 'Empty URI' };
    const m = STRIP(uri).match(/^([a-z0-9-]+):\/\/(.+)$/i);
    if (!m) return { ok: false, error: 'Not a URI (missing scheme://)' };
    const [, scheme, rest] = m;
    const sl = scheme.toLowerCase();
    if (!/^(slipnet|slipnet-enc|dnst|noiz|vay)$/.test(sl)) {
        return { ok: false, error: `Unsupported scheme: ${scheme}` };
    }

    const payload = rest.split('#')[0].split('?')[0];

    if (sl === 'slipnet-enc') {
        return {
            ok: false,
            encrypted: true,
            _scheme: scheme,
            error:
                'This is an ENCRYPTED (locked) SlipNet config. It uses AES-256-GCM with a private ' +
                'key compiled into the official SlipNet binary, so it cannot be decoded by any third ' +
                'party. Open the SlipNet app → edit the profile → turn OFF "Lock config" / ' +
                '"Encrypted export" and re-share. You will get a regular slipnet:// URI we can read.',
        };
    }

    const bin = b64decode(payload);
    if (bin == null) return { ok: false, error: 'Base64 decode failed' };

    // SlipNet pipe format: short version field, lots of "|" separators.
    if (bin.indexOf('|') >= 0 && bin.split('|').length >= 5) {
        const piped = parsePipeFormat(binToUtf8(bin) || bin);
        if (piped) return { ok: true, _scheme: scheme, ...piped };
    }

    const text = binToUtf8(bin);
    if (text && (text.startsWith('{') || text.startsWith('['))) {
        try {
            const obj = JSON.parse(text);
            if (obj && typeof obj === 'object') {
                return { ok: true, _scheme: scheme, _format: 'json', ...flatten(obj) };
            }
        } catch { /* fall through */ }
    }
    if (text && /[=&]/.test(text)) {
        const out = { ok: true, _scheme: scheme, _format: 'querystring' };
        for (const part of text.split('&')) {
            const [k, ...v] = part.split('=');
            if (!k) continue;
            try { out[decodeURIComponent(k)] = decodeURIComponent(v.join('=')); }
            catch { out[k] = v.join('='); }
        }
        return out;
    }

    return { ok: false, error: 'Decoded payload is not in a recognized SlipNet format' };
}

function flatten(obj, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
        else out[key] = v;
    }
    return out;
}

/** Encode our normalized config back into a SlipNet pipe-delimited URI.
 *  Always emits plain slipnet:// (cannot produce slipnet-enc:// without the private key). */
export function encodeSlipnetUri(fields, scheme = 'slipnet') {
    const f = fields || {};
    const reverseMap = {
        dnstt: 'dnstt', noizdns: 'sayedns', vaydns: 'vaydns', slipstream: 'ss',
        ssh: 'ssh', socks5: 'socks5', vless: 'vless', doh: 'doh', naive: 'naive',
    };
    const ttype = reverseMap[String(f.mode || '').toLowerCase()] || f.tunnelTypeRaw || f.mode || 'dnstt';
    const resolversField = Array.isArray(f.resolvers) && f.resolvers.length
        ? f.resolvers.map((r) => `${r}:53:0`).join(',')
        : (f.resolver ? `${f.resolver}:53:0` : '');

    const arr = new Array(70).fill('');
    const set = (i, v) => { if (v !== undefined && v !== null && v !== '') arr[i] = String(v); };
    const setBool = (i, v) => { arr[i] = v ? '1' : '0'; };

    set(0, f._version || '18');
    set(1, ttype);
    set(2, f.name || '');
    set(3, f.domain || '');
    set(4, resolversField);
    setBool(5, !!f.authMode);
    set(6, f.keepAlive);
    set(7, f.cc || '');
    set(8, f.localPort);
    set(9, f.localHost || '');
    setBool(10, !!f.gso);
    set(11, f.pubkey || '');
    set(12, f.socksUser || '');
    set(13, f.socksPass || '');
    setBool(14, !!f.sshEnabled);
    set(15, f.sshUser || '');
    set(16, f.sshPass || '');
    set(17, f.sshPort);
    set(19, f.sshHost || '');
    set(21, f.dohUrl || '');
    set(22, f.dnsTransport || '');
    setBool(31, !!f.isLocked);
    setBool(38, !!f.noizdnsStealth);
    set(39, f.dnsPayloadSize);
    setBool(41, !!f.vaydnsDnsttCompat);
    set(42, f.recordType || '');
    set(43, f.maxQname);
    set(44, f.rps);
    set(45, f.idleTimeout);
    set(46, f.vaydnsKeepAlive);
    set(47, f.udpTimeout);
    set(48, f.maxDataLabels);
    set(49, f.clientIdSize);
    setBool(50, !!f.sshTlsEnabled);
    set(51, f.sshTlsSni || '');
    set(52, f.sshHttpProxyHost || '');
    set(53, f.sshHttpProxyPort);
    set(54, f.sshHttpProxyHostHeader || '');
    setBool(55, !!f.sshWsEnabled);
    set(56, f.sshWsPath || '');
    setBool(57, !!f.sshWsUseTls);
    set(58, f.sshWsHost || '');
    if (f.sshPayload) {
        try { arr[59] = btoa(unescape(encodeURIComponent(f.sshPayload))); }
        catch { arr[59] = btoa(f.sshPayload); }
    }
    set(60, f.resolverMode || '');
    set(61, f.rrSpreadCount);

    while (arr.length && arr[arr.length - 1] === '') arr.pop();
    return `${scheme}://${b64urlEncode(arr.join('|'))}`;
}

/** Map common field aliases into our normalized config shape (post-parse). */
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
        ok: f.ok !== false,
        encrypted: !!f.encrypted,
        error: f.error,
        _scheme: f._scheme,
        _format: f._format,
        _version: f._version,
        tunnelTypeRaw: f.tunnelTypeRaw,
        sshChained: !!f.sshChained,
        name: pick('name', 'profileName', 'remarks'),
        domain: pick('domain', 'd', 'host'),
        resolvers: f.resolvers,
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
        keepAlive: pick('keepAlive', 'vaydnsKeepAlive'),
        udpTimeout: pick('udpTimeout'),
        maxDataLabels: pick('maxDataLabels'),
        maxQuerySize: pick('maxQuerySize', 'dnsPayloadSize'),
        queryPadding: pick('queryPadding'),
        dohUrl: pick('dohUrl'),
        utlsFingerprint: pick('utlsFingerprint', 'utls'),
        direct: pick('direct'),
        dnsTransport: pick('dnsTransport'),
        stealth: pick('stealth', 'noizdnsStealth'),
        isLocked: pick('isLocked'),
    };
}
