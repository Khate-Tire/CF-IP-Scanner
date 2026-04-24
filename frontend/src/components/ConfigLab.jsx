/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { FlaskConical, Copy, Trash2, Plus, Zap, Crown, Globe, X, Settings2, ShieldAlert, Share2, Wand2, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { testConfigRemote, dnsQuickTest, dnsE2ETest } from '../api';
import { parseSlipnetUri, encodeSlipnetUri, normalize as normalizeSlipnet } from '../utils/slipnetUri';
import { getBridgePayload, subscribeBridge, clearBridgePayload } from '../state/optimizerBridge';

// Curated DNS resolvers — covers global + Iran/China-friendly options
const PRESET_RESOLVERS = [
    { ip: '1.1.1.1', name: 'Cloudflare', tag: 'global' },
    { ip: '1.0.0.1', name: 'Cloudflare 2', tag: 'global' },
    { ip: '8.8.8.8', name: 'Google', tag: 'global' },
    { ip: '8.8.4.4', name: 'Google 2', tag: 'global' },
    { ip: '9.9.9.9', name: 'Quad9', tag: 'global' },
    { ip: '149.112.112.112', name: 'Quad9 2', tag: 'global' },
    { ip: '94.140.14.14', name: 'AdGuard', tag: 'global' },
    { ip: '208.67.222.222', name: 'OpenDNS', tag: 'global' },
    { ip: '178.22.122.100', name: 'Shecan', tag: 'iran' },
    { ip: '185.51.200.2', name: 'Shecan 2', tag: 'iran' },
    { ip: '78.157.42.100', name: 'Electro', tag: 'iran' },
    { ip: '78.157.42.101', name: 'Electro 2', tag: 'iran' },
    { ip: '10.202.10.202', name: '403.online', tag: 'iran' },
    { ip: '185.55.226.26', name: 'Begzar', tag: 'iran' },
    { ip: '4.2.2.4', name: 'Level3', tag: 'global' },
    { ip: '64.6.64.6', name: 'Verisign', tag: 'global' },
];

// Best-effort: extract the host (server address) from any common config URL.
// Returns null if cannot detect (e.g. opaque base64 blobs like slipnet-enc://...).
function extractHostFromConfig(raw) {
    if (!raw) return null;
    const s = raw.trim();
    try {
        // vless://, trojan://, ss://user@host:port, vmess base64, hy2://, tuic://
        if (/^(vless|trojan|hy2|hysteria2?|tuic|ss|socks|http|https):\/\//i.test(s)) {
            const u = new URL(s);
            if (u.hostname) return u.hostname;
        }
        // vmess:// is base64-JSON
        if (/^vmess:\/\//i.test(s)) {
            try {
                const b64 = s.replace(/^vmess:\/\//i, '').split('#')[0].split('?')[0];
                const json = JSON.parse(atob(b64));
                if (json.add) return json.add;
            } catch { /* ignore */ }
        }
        // Generic fallback: look for a host:port pattern
        const m = s.match(/@([a-z0-9.-]+)(?::\d+)?/i);
        if (m && m[1]) return m[1];
        const m2 = s.match(/([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/i);
        if (m2 && m2[1]) return m2[1];
    } catch { /* ignore */ }
    return null;
}

function detectProtocol(raw) {
    if (!raw) return null;
    const m = raw.trim().match(/^([a-z0-9-]+):\/\//i);
    return m ? m[1].toLowerCase() : 'unknown';
}

const RECORD_TYPES = ['TXT', 'CNAME', 'A', 'AAAA', 'MX', 'NS', 'SRV'];
const STEALTH_PRESETS = [
    { id: 'off', label: 'Off', size: 0, padding: 0 },
    { id: 'large', label: 'Large (100)', size: 100, padding: 0 },
    { id: 'medium', label: 'Medium (80)', size: 80, padding: 10 },
    { id: 'small', label: 'Small (60)', size: 60, padding: 15 },
    { id: 'minimum', label: 'Minimum (50)', size: 50, padding: 20 },
];
const PROTOCOL_MODES = [
    { id: 'auto', label: 'Auto-detect' },
    { id: 'dnstt', label: 'DNSTT (classic)' },
    { id: 'noizdns', label: 'NoizDNS (DPI-resistant)' },
    { id: 'vaydns', label: 'VayDNS (optimized)' },
    { id: 'slipstream', label: 'Slipstream (QUIC)' },
];

// DNS transport actually used to talk to the resolver during the test
const DNS_TRANSPORTS = [
    { id: 'udp', label: 'UDP', tip: 'Plain DNS port 53 (fastest, most blockable)' },
    { id: 'tcp', label: 'TCP', tip: 'TCP port 53 (avoids UDP filtering)' },
    { id: 'tls', label: 'DoT', tip: 'DNS-over-TLS port 853 (encrypted)' },
    { id: 'https', label: 'DoH', tip: 'DNS-over-HTTPS port 443 (most stealthy)' },
    { id: 'sweep', label: 'Sweep ALL', tip: 'Run UDP+TCP+DoT+DoH and pick the best per resolver' },
];

// uTLS fingerprints — metadata hint passed to backend & saved in slipnet:// URI
const UTLS_FINGERPRINTS = [
    { id: '', label: 'Default' },
    { id: 'chrome_120', label: 'Chrome 120' },
    { id: 'firefox_120', label: 'Firefox 120' },
    { id: 'safari_16', label: 'Safari 16' },
    { id: 'ios_15', label: 'iOS 15' },
    { id: 'random', label: 'Random' },
];

const QUICK_SAMPLE_CONFIGS = [
    {
        id: 'vless',
        label: 'VLESS example',
        value: 'vless://uuid@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2F#example',
    },
    {
        id: 'trojan',
        label: 'Trojan example',
        value: 'trojan://password@example.com:443?security=tls&type=ws&host=example.com&path=%2F#example',
    },
    {
        id: 'slipnet',
        label: 'SlipNet placeholder',
        value: 'slipnet://PASTE_YOUR_PROFILE_HERE',
    },
];

const AUTO_RUN_KEY = 'config_lab_auto_run_v1';

function Score({ value, max = 6 }) {
    const pct = Math.round((value / max) * 100);
    const cls =
        value >= max * 0.66 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
        : value >= max * 0.33 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
        : 'bg-red-500/20 text-red-400 border-red-500/30';
    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${cls}`}>
            {value}/{max} ({pct}%)
        </span>
    );
}

export default function ConfigLab({ onSendToDeploy, onGoToOptimizer } = {}) {
    const { t } = useTranslation();
    const [config, setConfig] = useState('');
    const [customResolver, setCustomResolver] = useState('');
    const [selectedResolvers, setSelectedResolvers] = useState(
        // Default: top 4 mixed (global + iran)
        ['1.1.1.1', '8.8.8.8', '178.22.122.100', '78.157.42.100']
    );
    const [extraResolvers, setExtraResolvers] = useState([]);
    const [filter, setFilter] = useState('all'); // 'all' | 'global' | 'iran'

    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
    const [configResult, setConfigResult] = useState(null); // { ok, message, result: { ping, jitter, download, upload } }
    const [dnsResults, setDnsResults] = useState([]); // [{ resolver, name, latency, score, edns, ok }]
    const cancelRef = useRef(false);

    // Advanced settings
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [tunnelMode, setTunnelMode] = useState('auto');
    const [directMode, setDirectMode] = useState(false);
    const [stealthPreset, setStealthPreset] = useState('off');
    const [customQuerySize, setCustomQuerySize] = useState('');
    const [customPadding, setCustomPadding] = useState('');
    // VayDNS knobs
    const [vayRecordType, setVayRecordType] = useState('TXT');
    const [vayMaxQname, setVayMaxQname] = useState(101);
    const [vayRps, setVayRps] = useState(0);
    const [vayClientIdSize, setVayClientIdSize] = useState(2);
    const [dnsTransport, setDnsTransport] = useState('udp');
    const [utlsFingerprint, setUtlsFingerprint] = useState('');
    const [e2eMode, setE2eMode] = useState(false);
    const [e2eTarget, setE2eTarget] = useState('https://www.cloudflare.com/cdn-cgi/trace');

    // slipnet:// share modal
    const [parsedSlipnet, setParsedSlipnet] = useState(null);
    const [shareUri, setShareUri] = useState('');
    const [autoRunOnPaste, setAutoRunOnPaste] = useState(() => {
        try {
            const raw = localStorage.getItem(AUTO_RUN_KEY);
            return raw ? raw === '1' : false;
        } catch {
            return false;
        }
    });
    const autoRunTimerRef = useRef(null);
    const lastAutoRunSignatureRef = useRef('');

    const detectedHost = useMemo(() => extractHostFromConfig(config), [config]);
    const protocol = useMemo(() => detectProtocol(config), [config]);
    const isSlipnetUri = useMemo(() => /^(slipnet|slipnet-enc|dnst|noiz|vay):\/\//i.test(config.trim()), [config]);
    const isEncryptedSlipnet = useMemo(() => /^slipnet-enc:\/\//i.test(config.trim()), [config]);
    const effectiveTestHost = useMemo(() => {
        if (!isSlipnetUri) return detectedHost || 'cloudflare.com';
        if (parsedSlipnet?.domain) return parsedSlipnet.domain;
        const parsed = parseSlipnetUri(config.trim());
        if (parsed && parsed.ok) {
            const norm = normalizeSlipnet(parsed);
            if (norm?.domain) return norm.domain;
        }
        return 'cloudflare.com';
    }, [isSlipnetUri, parsedSlipnet, config, detectedHost]);

    useEffect(() => {
        try {
            localStorage.setItem(AUTO_RUN_KEY, autoRunOnPaste ? '1' : '0');
        } catch {
            // ignore storage failures
        }
    }, [autoRunOnPaste]);
    const stealthCfg = useMemo(() => {
        if (stealthPreset === 'custom') {
            return { size: parseInt(customQuerySize, 10) || 0, padding: parseInt(customPadding, 10) || 0 };
        }
        const p = STEALTH_PRESETS.find(p => p.id === stealthPreset);
        return { size: p?.size || 0, padding: p?.padding || 0 };
    }, [stealthPreset, customQuerySize, customPadding]);
    const allResolvers = useMemo(() => {
        const set = new Map();
        PRESET_RESOLVERS.forEach(r => set.set(r.ip, r));
        extraResolvers.forEach(ip => { if (!set.has(ip)) set.set(ip, { ip, name: 'Custom', tag: 'custom' }); });
        return Array.from(set.values());
    }, [extraResolvers]);

    const visibleResolvers = useMemo(
        () => allResolvers.filter(r => filter === 'all' || r.tag === filter || r.tag === 'custom'),
        [allResolvers, filter]
    );

    const toggleResolver = (ip) => {
        setSelectedResolvers(prev => prev.includes(ip) ? prev.filter(x => x !== ip) : [...prev, ip]);
    };

    const addCustomResolver = () => {
        const ip = customResolver.trim();
        if (!ip) return;
        // Simple IPv4 validation
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
            toast.error(t('configLab.invalidIp', 'Invalid IPv4 address'));
            return;
        }
        if (!extraResolvers.includes(ip) && !PRESET_RESOLVERS.some(r => r.ip === ip)) {
            setExtraResolvers(prev => [...prev, ip]);
        }
        if (!selectedResolvers.includes(ip)) {
            setSelectedResolvers(prev => [...prev, ip]);
        }
        setCustomResolver('');
    };

    const removeCustomResolver = (ip) => {
        setExtraResolvers(prev => prev.filter(x => x !== ip));
        setSelectedResolvers(prev => prev.filter(x => x !== ip));
    };

    const selectAllVisible = () => {
        setSelectedResolvers(prev => Array.from(new Set([...prev, ...visibleResolvers.map(r => r.ip)])));
    };

    const clearSelection = () => setSelectedResolvers([]);

    const runBatteryInternal = async ({ resolverOverride = null, hostOverride = null, skipConfigTest = false } = {}) => {
        if (!config.trim()) {
            toast.error(t('configLab.noConfig', 'Paste a config first'));
            return;
        }
        const activeResolvers = Array.isArray(resolverOverride) && resolverOverride.length ? resolverOverride : selectedResolvers;
        if (activeResolvers.length === 0) {
            toast.error(t('configLab.noResolvers', 'Select at least one DNS resolver'));
            return;
        }
        // For slipnet:// profiles use profile domain; for others use extracted host.
        const host = hostOverride || effectiveTestHost;
        cancelRef.current = false;
        setRunning(true);
        setConfigResult(null);
        setDnsResults([]);
        setProgress({ done: 0, total: activeResolvers.length + 1, label: t('configLab.testingConfig', 'Testing config…') });

        // 1) Test the config itself — only meaningful for v2ray/xray-style URIs.
        if (skipConfigTest || isSlipnetUri) {
            setConfigResult({
                success: true,
                skipped: true,
                message: t(
                    'configLab.slipnetSkipConfigTest',
                    'SlipNet profile detected — skipping v2ray/xray config test. Only DNS resolver tests will run.'
                ),
            });
        } else {
            try {
                const r = await testConfigRemote(config.trim());
                setConfigResult(r);
                if (!r.success) {
                    toast.error(`${t('configLab.configFailed', 'Config test failed')}: ${r.error || r.message || 'unknown'}`);
                }
            } catch (e) {
                setConfigResult({ success: false, error: String(e?.message || e) });
            }
        }
        setProgress(p => ({ ...p, done: 1, label: t('configLab.testingDns', 'Testing DNS resolvers…') }));

        // 2) Test each selected DNS resolver against the config's host
        const results = [];
        const transports = dnsTransport === 'sweep' ? ['udp', 'tcp', 'tls', 'https'] : [dnsTransport];
        for (let i = 0; i < activeResolvers.length; i++) {
            if (cancelRef.current) break;
            const ip = activeResolvers[i];
            const meta = allResolvers.find(r => r.ip === ip) || { name: 'Custom' };

            // For sweep mode: test all transports, keep the best one
            let best = null;
            for (const proto of transports) {
                if (cancelRef.current) break;
                try {
                    let res;
                    if (e2eMode) {
                        res = await dnsE2ETest(ip, { domain: host, target_url: e2eTarget, protocol: proto });
                        const ok = res?.dns_ok && res?.http_ok && !res?.poisoned;
                        const cand = {
                            resolver: ip, name: meta.name, tag: meta.tag, protocol: proto,
                            latency: res?.total_latency_ms ?? res?.dns_latency_ms ?? null,
                            score: ok ? 6 : (res?.dns_ok ? 2 : 0),
                            edns: false,
                            hijack: !!res?.poisoned,
                            httpStatus: res?.http_status,
                            ok,
                            e2e: true,
                            raw: res,
                        };
                        if (!best || (cand.ok && !best.ok) || (cand.ok === best.ok && (cand.latency ?? 99999) < (best.latency ?? 99999))) {
                            best = cand;
                        }
                    } else {
                        res = await dnsQuickTest(ip, host, { protocol: proto, utls_fingerprint: utlsFingerprint || null });
                        const cand = {
                            resolver: ip, name: meta.name, tag: meta.tag, protocol: proto,
                            latency: res?.latency_ms ?? res?.latency ?? null,
                            score: res?.score ?? 0,
                            edns: res?.edns_support ?? res?.edns ?? false,
                            hijack: res?.nxdomain_hijack === true,
                            answers: res?.answers ?? [],
                            ok: res?.ok !== false && (res?.latency_ms ?? res?.latency) != null,
                            raw: res,
                        };
                        if (!best || cand.score > best.score || (cand.score === best.score && (cand.latency ?? 99999) < (best.latency ?? 99999))) {
                            best = cand;
                        }
                    }
                } catch (_e) {
                    void _e;
                    if (!best) best = { resolver: ip, name: meta.name, tag: meta.tag, ok: false, protocol: proto };
                }
            }
            results.push(best);
            setDnsResults([...results]);
            setProgress(p => ({ ...p, done: 2 + i }));
        }

        setRunning(false);
        setProgress({ done: 0, total: 0, label: '' });
        if (!cancelRef.current) {
            toast.success(t('configLab.batteryDone', 'Battery test complete'));
        }
    };

    const runBattery = async () => {
        await runBatteryInternal();
    };

    const stopBattery = () => {
        cancelRef.current = true;
        setRunning(false);
        toast(t('configLab.stopped', 'Stopped'));
    };

    const sortedDns = useMemo(() => {
        return [...dnsResults].sort((a, b) => {
            // Prefer ok, then higher score, then lower latency
            if (a.ok !== b.ok) return a.ok ? -1 : 1;
            if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
            return (a.latency ?? 99999) - (b.latency ?? 99999);
        });
    }, [dnsResults]);

    const bestDns = sortedDns.length > 0 && sortedDns[0].ok ? sortedDns[0] : null;
    const configOk = configResult?.success;
    const cfgMetrics = configResult?.result || {};

    const copyText = (txt) => {
        navigator.clipboard.writeText(txt).then(
            () => toast.success(t('configLab.copied', 'Copied')),
            () => toast.error(t('configLab.copyFailed', 'Copy failed'))
        );
    };

    // ── slipnet:// URI handlers ──
    const importSlipnet = () => {
        const parsed = parseSlipnetUri(config.trim());
        if (!parsed || parsed.ok === false) {
            if (parsed && parsed.encrypted) {
                toast.error(
                    t(
                        'configLab.encryptedSlipnet',
                        'Encrypted (locked) SlipNet config — cannot decode. Re-export from the SlipNet app with "Lock config" turned OFF.'
                    ),
                    { duration: 9000 }
                );
            } else {
                toast.error(
                    (parsed && parsed.error) ||
                    t('configLab.invalidSlipnet', 'Not a valid slipnet:// URI')
                );
            }
            return;
        }
        const norm = normalizeSlipnet(parsed);
        setParsedSlipnet(norm);
        // Pull in additional resolvers if the profile carried a comma-separated list.
        if (Array.isArray(parsed.resolvers)) {
            for (const ip of parsed.resolvers) {
                if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) continue;
                if (!extraResolvers.includes(ip) && !PRESET_RESOLVERS.some(r => r.ip === ip)) {
                    setExtraResolvers(prev => prev.includes(ip) ? prev : [...prev, ip]);
                }
                if (!selectedResolvers.includes(ip)) {
                    setSelectedResolvers(prev => prev.includes(ip) ? prev : [...prev, ip]);
                }
            }
        }
        if (norm.dnsTransport) {
            const tx = String(norm.dnsTransport).toLowerCase();
            const map = { udp: 'udp', tcp: 'tcp', tls: 'tls', dot: 'tls', https: 'https', doh: 'https' };
            if (map[tx]) setDnsTransport(map[tx]);
        }
        // Auto-apply known fields
        if (norm.resolver && /^(\d{1,3}\.){3}\d{1,3}$/.test(norm.resolver)) {
            if (!extraResolvers.includes(norm.resolver) && !PRESET_RESOLVERS.some(r => r.ip === norm.resolver)) {
                setExtraResolvers(prev => [...prev, norm.resolver]);
            }
            if (!selectedResolvers.includes(norm.resolver)) {
                setSelectedResolvers(prev => [...prev, norm.resolver]);
            }
        }
        if (norm.mode && PROTOCOL_MODES.some(m => m.id === norm.mode.toLowerCase())) {
            setTunnelMode(norm.mode.toLowerCase());
        }
        if (norm.recordType && RECORD_TYPES.includes(norm.recordType.toUpperCase())) {
            setVayRecordType(norm.recordType.toUpperCase());
        }
        if (norm.maxQname) setVayMaxQname(parseInt(norm.maxQname, 10) || 101);
        if (norm.rps) setVayRps(parseInt(norm.rps, 10) || 0);
        if (norm.clientIdSize) setVayClientIdSize(parseInt(norm.clientIdSize, 10) || 2);
        if (norm.maxQuerySize) {
            const sz = parseInt(norm.maxQuerySize, 10);
            const preset = STEALTH_PRESETS.find(p => p.size === sz);
            if (preset) setStealthPreset(preset.id);
            else { setStealthPreset('custom'); setCustomQuerySize(String(sz)); }
        }
        if (norm.direct === true || norm.direct === 'true' || norm.direct === '1') setDirectMode(true);
        toast.success(t('configLab.slipnetImported', 'slipnet:// profile imported'));
        setShowAdvanced(true);
    };

    const exportSlipnet = () => {
        const fields = {
            name: parsedSlipnet?.name || `cf-ip-scanner-${Date.now()}`,
            domain: detectedHost || parsedSlipnet?.domain || '',
            resolver: selectedResolvers[0] || '',
            mode: tunnelMode === 'auto' ? 'dnstt' : tunnelMode,
            pubkey: parsedSlipnet?.pubkey || '',
            recordType: vayRecordType,
            maxQname: vayMaxQname,
            rps: vayRps,
            clientIdSize: vayClientIdSize,
            maxQuerySize: stealthCfg.size,
            queryPadding: stealthCfg.padding,
            direct: directMode,
            dnsTransport,
            utlsFingerprint,
        };
        const uri = encodeSlipnetUri(fields, 'slipnet');
        setShareUri(uri);
        copyText(uri);
    };

    const runSmartSlipnetTest = async () => {
        if (!config.trim()) {
            toast.error(t('configLab.noConfig', 'Paste a config first'));
            return;
        }
        if (!isSlipnetUri) {
            runBattery();
            return;
        }
        const parsed = parseSlipnetUri(config.trim());
        if (!parsed || parsed.ok === false) {
            if (parsed?.encrypted) {
                toast.error(
                    t(
                        'configLab.encryptedSlipnet',
                        'Encrypted (locked) SlipNet config — cannot decode. Re-export from the SlipNet app with "Lock config" turned OFF.'
                    ),
                    { duration: 9000 }
                );
            } else {
                toast.error((parsed && parsed.error) || t('configLab.invalidSlipnet', 'Not a valid slipnet:// URI'));
            }
            return;
        }

        if (!parsedSlipnet || !parsedSlipnet.domain) {
            importSlipnet();
        }

        const baselineResolvers = ['1.1.1.1', '8.8.8.8'];
        const importedResolvers = Array.isArray(parsed.resolvers) ? parsed.resolvers.filter(ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) : [];
        const mergedResolvers = Array.from(new Set([...selectedResolvers, ...importedResolvers, ...baselineResolvers]));
        setSelectedResolvers(mergedResolvers);

        setShowAdvanced(true);
        setDnsTransport('sweep');
        setE2eMode(true);
        toast.success(t('configLab.smartReady', 'Smart test enabled: Sweep ALL + E2E + imported resolvers'));

        const normalized = normalizeSlipnet(parsed);
        const host = normalized?.domain || effectiveTestHost;
        await runBatteryInternal({ resolverOverride: mergedResolvers, hostOverride: host, skipConfigTest: true });
    };

    const runSmartAnyConfigTest = async () => {
        if (!config.trim()) {
            toast.error(t('configLab.noConfig', 'Paste a config first'));
            return;
        }

        if (isSlipnetUri) {
            await runSmartSlipnetTest();
            return;
        }

        const baselineResolvers = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
        const mergedResolvers = Array.from(new Set([...selectedResolvers, ...baselineResolvers]));
        setSelectedResolvers(mergedResolvers);
        setShowAdvanced(true);
        setDnsTransport('sweep');
        setE2eMode(false);
        toast.success(t('configLab.smartReadyAny', 'Smart test enabled: Sweep ALL + baseline resolvers'));
        await runBatteryInternal({ resolverOverride: mergedResolvers });
    };

    const fillSampleConfig = (raw) => {
        setConfig(raw);
        setParsedSlipnet(null);
        setConfigResult(null);
        setDnsResults([]);
    };

    // ── Bridge: pre-load resolvers/host coming from DNS Optimizer handoff ──
    const [bridgePayload, setBridgePayloadState] = useState(() => getBridgePayload());
    const consumedBridgeRef = useRef(false);
    useEffect(() => {
        const off = subscribeBridge((p) => {
            setBridgePayloadState(p);
            consumedBridgeRef.current = false;
        });
        return off;
    }, []);

    // When a bridge payload from DNS Optimizer arrives, pre-add its resolvers and
    // arm the auto-run pipeline. Runs once per payload.
    useEffect(() => {
        if (!bridgePayload || bridgePayload.source !== 'optimizer') return;
        if (consumedBridgeRef.current) return;
        consumedBridgeRef.current = true;

        const ips = (bridgePayload.resolvers || []).filter(ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip));
        if (ips.length) {
            setExtraResolvers(prev => Array.from(new Set([...prev, ...ips.filter(ip => !PRESET_RESOLVERS.some(r => r.ip === ip))])));
            setSelectedResolvers(prev => Array.from(new Set([...prev, ...ips])));
        }
        if (bridgePayload.transport && bridgePayload.transport !== 'auto') {
            setDnsTransport(bridgePayload.transport);
        }
        if (bridgePayload.mode && PROTOCOL_MODES.some(m => m.id === bridgePayload.mode)) {
            setTunnelMode(bridgePayload.mode);
        }
        toast.success(t('configLab.bridgeReceived', 'Resolvers received from DNS Optimizer — paste a config and click Smart Test (or enable auto-run).'));
    }, [bridgePayload, t]);

    const applyBestToDeploy = () => {
        if (!bestDns || !onSendToDeploy) return;
        const payload = {
            winner: {
                resolver: bestDns.resolver,
                transport: bestDns.protocol || dnsTransport,
                latency: bestDns.latency,
                score: bestDns.score,
                host: effectiveTestHost,
            },
            resolvers: selectedResolvers,
            host: effectiveTestHost,
            domain: parsedSlipnet?.domain || effectiveTestHost,
            transport: bestDns.protocol || dnsTransport,
            mode: tunnelMode === 'auto' ? (parsedSlipnet?.mode || 'dnstt') : tunnelMode,
        };
        onSendToDeploy(payload);
        toast.success(t('configLab.appliedToDeploy', 'Best settings sent to Deploy Wizard'));
    };

    useEffect(() => {
        if (!autoRunOnPaste || running || !config.trim()) return;
        const signature = `${config.trim()}::${protocol}`;
        if (signature === lastAutoRunSignatureRef.current) return;

        if (autoRunTimerRef.current) {
            clearTimeout(autoRunTimerRef.current);
            autoRunTimerRef.current = null;
        }

        autoRunTimerRef.current = setTimeout(async () => {
            if (running) return;
            lastAutoRunSignatureRef.current = signature;
            await runSmartAnyConfigTest();
        }, 600);

        return () => {
            if (autoRunTimerRef.current) {
                clearTimeout(autoRunTimerRef.current);
                autoRunTimerRef.current = null;
            }
        };
        // We intentionally avoid depending on selectedResolvers to prevent loops after smart setup.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunOnPaste, config, protocol, isSlipnetUri, running]);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border border-indigo-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                        <FlaskConical className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">{t('configLab.title', 'Config Lab')}</h3>
                        <p className="text-xs text-gray-400">{t('configLab.subtitle', 'Paste any config and battery-test it across DNS resolvers to find the best pairing for your network')}</p>
                    </div>
                </div>
            </div>

            {/* Config input */}
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 space-y-3">
                <label className="text-sm font-bold text-gray-300 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-indigo-400" />
                    {t('configLab.configLabel', 'Paste any config (vless://, vmess://, trojan://, ss://, hy2://, tuic://, slipnet-enc://...)')}
                </label>
                <textarea
                    value={config}
                    onChange={e => setConfig(e.target.value)}
                    placeholder="vless://uuid@host:443?encryption=none&security=tls&type=ws&host=example.com#name"
                    rows={4}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono placeholder-gray-600 focus:border-indigo-500/50 focus:outline-none resize-y"
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-gray-500">{t('configLab.quickSamples', 'Quick samples')}:</span>
                    {QUICK_SAMPLE_CONFIGS.map(s => (
                        <button
                            key={s.id}
                            onClick={() => fillSampleConfig(s.value)}
                            className="px-2.5 py-1 rounded-full bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/30 font-bold"
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
                {config.trim() && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                            {t('configLab.protocol', 'Protocol')}: <strong>{protocol}</strong>
                        </span>
                        {detectedHost ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                {t('configLab.host', 'Host')}: <strong>{detectedHost}</strong>
                            </span>
                        ) : (
                            <span className="px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                                {t('configLab.opaqueConfig', 'Opaque config — DNS tests will use cloudflare.com as proxy host')}
                            </span>
                        )}
                        {isSlipnetUri && (
                            <button
                                onClick={importSlipnet}
                                className="px-2.5 py-1 rounded-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/40 font-bold flex items-center gap-1"
                                title={t('configLab.importSlipnetTip', 'Decode the slipnet:// URI and auto-fill resolver, mode, VayDNS settings')}
                            >
                                <Wand2 className="w-3 h-3" /> {t('configLab.importSlipnet', 'Import slipnet:// profile')}
                            </button>
                        )}
                        <button
                            onClick={() => setConfig('')}
                            className="ml-auto text-xs text-gray-500 hover:text-red-400 flex items-center gap-1"
                        >
                            <Trash2 className="w-3 h-3" /> {t('configLab.clear', 'Clear')}
                        </button>
                    </div>
                )}
                {isEncryptedSlipnet && (
                    <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-200 space-y-1">
                        <div className="font-bold flex items-center gap-2">
                            <Wand2 className="w-3 h-3" />
                            {t('configLab.encryptedSlipnetTitle', 'Encrypted (locked) SlipNet profile')}
                        </div>
                        <div className="text-yellow-100/90 leading-relaxed">
                            {t(
                                'configLab.encryptedSlipnetBody',
                                'slipnet-enc:// configs are AES-256-GCM encrypted with a private key compiled into the official SlipNet binary. Third-party tools cannot decode them. Open SlipNet → edit profile → turn OFF "Lock config" / "Encrypted export" and re-share — you will get a regular slipnet:// URI we can read. The DNS resolver tests below will still run against your selected resolvers using cloudflare.com as the probe host.'
                            )}
                        </div>
                    </div>
                )}
                {isSlipnetUri && !isEncryptedSlipnet && (
                    <div className="mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-100 space-y-2">
                        <div className="font-bold text-emerald-300">{t('configLab.smartGuideTitle', 'One-click SlipNet test (recommended)')}</div>
                        <div className="leading-relaxed text-emerald-100/90">
                            {t('configLab.smartGuideBody', 'Use Smart Test to auto-import profile values, add fallback resolvers, enable Sweep ALL transports, run E2E checks, and rank the best resolver for real-world performance.')}
                        </div>
                        <button
                            onClick={runSmartSlipnetTest}
                            disabled={running}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-100 text-xs font-bold border border-emerald-400/40 disabled:opacity-50"
                        >
                            {t('configLab.smartTestButton', 'Auto setup + run real test')}
                        </button>
                    </div>
                )}
                {!isSlipnetUri && config.trim() && (
                    <div className="mt-3 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-100 space-y-2">
                        <div className="font-bold text-indigo-300">{t('configLab.smartGuideAnyTitle', 'One-click smart test')}</div>
                        <div className="leading-relaxed text-indigo-100/90">
                            {t('configLab.smartGuideAnyBody', 'Auto-add baseline resolvers, run all transports (UDP/TCP/DoT/DoH), then rank by score and latency.')}
                        </div>
                        <button
                            onClick={runSmartAnyConfigTest}
                            disabled={running}
                            className="px-3 py-1.5 rounded-lg bg-indigo-500/25 hover:bg-indigo-500/35 text-indigo-100 text-xs font-bold border border-indigo-400/40 disabled:opacity-50"
                        >
                            {t('configLab.smartTestAnyButton', 'Auto setup + run smart test')}
                        </button>
                    </div>
                )}
                {parsedSlipnet && (
                    <div className="mt-3 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20 text-xs space-y-1">
                        <div className="font-bold text-purple-300 flex items-center gap-2">
                            <Share2 className="w-3 h-3" /> {t('configLab.slipnetProfile', 'slipnet:// profile')}
                            {parsedSlipnet.name && <span className="text-white">— {parsedSlipnet.name}</span>}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-gray-400 font-mono">
                            {parsedSlipnet.domain && <div>domain: <span className="text-white">{parsedSlipnet.domain}</span></div>}
                            {parsedSlipnet.resolver && <div>resolver: <span className="text-white">{parsedSlipnet.resolver}</span></div>}
                            {parsedSlipnet.mode && <div>mode: <span className="text-white">{parsedSlipnet.mode}</span></div>}
                            {parsedSlipnet.pubkey && <div className="col-span-2 truncate">pubkey: <span className="text-white">{String(parsedSlipnet.pubkey).slice(0, 24)}…</span></div>}
                            {parsedSlipnet.sshHost && <div>ssh: <span className="text-white">{parsedSlipnet.sshHost}:{parsedSlipnet.sshPort || 22}</span></div>}
                        </div>
                    </div>
                )}
            </div>

            {/* DNS Optimizer handoff banner */}
            {bridgePayload && bridgePayload.source === 'optimizer' && (
                <div className="bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border border-violet-500/30 rounded-2xl p-4 flex items-start gap-3 flex-wrap">
                    <div className="text-2xl">🔬</div>
                    <div className="flex-1 min-w-[220px]">
                        <div className="text-sm font-bold text-violet-300">
                            {t('configLab.bridgeBannerTitle', 'Top resolvers received from DNS Optimizer')}
                        </div>
                        <div className="text-xs text-violet-100/85 mt-1">
                            {t('configLab.bridgeBannerBody', 'These resolvers have been pre-selected. Paste your real config above and run Smart Test to validate them end-to-end against your network.')}
                        </div>
                        {Array.isArray(bridgePayload.resolvers) && bridgePayload.resolvers.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {bridgePayload.resolvers.slice(0, 10).map(ip => (
                                    <span key={ip} className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-200 border border-violet-500/30 font-mono text-[11px]">{ip}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col items-stretch gap-2">
                        {config.trim() && (
                            <button
                                onClick={runSmartAnyConfigTest}
                                disabled={running}
                                className="px-3 py-1.5 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-100 text-xs font-bold border border-emerald-400/40 disabled:opacity-50"
                            >
                                {t('configLab.bridgeRunNow', 'Run Smart Test now')}
                            </button>
                        )}
                        <button
                            onClick={() => { clearBridgePayload(); setBridgePayloadState(null); }}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold border border-white/10"
                        >
                            {t('configLab.dismiss', 'Dismiss')}
                        </button>
                    </div>
                </div>
            )}
            {!bridgePayload && onGoToOptimizer && (
                <div className="text-xs text-gray-400 flex items-center gap-2 justify-center">
                    <span>💡 {t('configLab.tipUseOptimizer', 'Want the fastest 10 resolvers for your network?')}</span>
                    <button
                        onClick={onGoToOptimizer}
                        className="px-2.5 py-1 rounded-md bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 text-xs font-bold border border-violet-500/30"
                    >
                        {t('configLab.openOptimizer', 'Run DNS Optimizer first →')}
                    </button>
                </div>
            )}

            {/* Resolver picker */}
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="text-sm font-bold text-gray-300">
                        {t('configLab.resolversLabel', 'DNS resolvers to test')} ({selectedResolvers.length} {t('configLab.selected', 'selected')})
                    </label>
                    <div className="flex items-center gap-1 bg-black/30 rounded-lg p-1">
                        {['all', 'global', 'iran'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-3 py-1 rounded-md text-xs font-bold transition ${filter === f ? 'bg-indigo-500/30 text-indigo-300' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                {t(`configLab.filter.${f}`, f === 'all' ? 'All' : f === 'global' ? '🌍 Global' : '🇮🇷 Iran-friendly')}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {visibleResolvers.map(r => {
                        const sel = selectedResolvers.includes(r.ip);
                        return (
                            <button
                                key={r.ip}
                                onClick={() => toggleResolver(r.ip)}
                                className={`group relative px-3 py-1.5 rounded-lg text-xs font-mono border transition flex items-center gap-2 ${
                                    sel
                                        ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200'
                                        : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'
                                }`}
                            >
                                <span className="font-bold not-italic">{r.name}</span>
                                <span className="opacity-70">{r.ip}</span>
                                {r.tag === 'custom' && (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => { e.stopPropagation(); removeCustomResolver(r.ip); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); removeCustomResolver(r.ip); } }}
                                        className="ml-1 p-0.5 rounded hover:bg-red-500/20 text-red-400 cursor-pointer"
                                        title={t('configLab.removeCustom', 'Remove custom resolver')}
                                    >
                                        <X className="w-3 h-3" />
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        type="text"
                        value={customResolver}
                        onChange={e => setCustomResolver(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addCustomResolver(); }}
                        placeholder="e.g. 1.1.1.2"
                        className="flex-1 min-w-[160px] bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-indigo-500/50 focus:outline-none"
                    />
                    <button onClick={addCustomResolver} className="px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-xs font-bold flex items-center gap-1 border border-indigo-500/30">
                        <Plus className="w-3 h-3" /> {t('configLab.addResolver', 'Add')}
                    </button>
                    <button onClick={selectAllVisible} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold border border-white/10">
                        {t('configLab.selectAll', 'Select all visible')}
                    </button>
                    <button onClick={clearSelection} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold border border-white/10">
                        {t('configLab.clearSelection', 'Clear')}
                    </button>
                </div>
            </div>

            {/* Advanced settings (SlipNet/dnstm-style) */}
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl">
                <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="w-full flex items-center justify-between p-4 text-sm font-bold text-gray-200 hover:text-white"
                >
                    <span className="flex items-center gap-2">
                        <Settings2 className="w-4 h-4 text-indigo-400" />
                        {t('configLab.advancedSettings', 'Advanced settings')}
                        <span className="text-xs font-normal text-gray-500">
                            ({tunnelMode}, {dnsTransport.toUpperCase()}{utlsFingerprint ? `, ${utlsFingerprint}` : ''}{e2eMode ? ', E2E' : ''}, {stealthPreset === 'off' ? 'no stealth' : stealthCfg.size + 'B'}{directMode ? ', direct' : ''})
                        </span>
                    </span>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showAdvanced && (
                    <div className="px-4 pb-4 space-y-5 border-t border-white/[0.05] pt-4">
                        {/* DNS transport (UDP/TCP/DoT/DoH/Sweep) */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('configLab.dnsTransport', 'DNS transport')}</label>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {DNS_TRANSPORTS.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setDnsTransport(p.id)}
                                        title={p.tip}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${dnsTransport === p.id ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200' : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'}`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* uTLS fingerprint */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('configLab.utlsFingerprint', 'uTLS fingerprint (DoT/DoH only)')}</label>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {UTLS_FINGERPRINTS.map(f => (
                                    <button
                                        key={f.id || 'default'}
                                        onClick={() => setUtlsFingerprint(f.id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${utlsFingerprint === f.id ? 'bg-rose-500/25 border-rose-500/50 text-rose-200' : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'}`}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                            <div className="mt-1 text-[11px] text-rose-200/60">{t('configLab.utlsHint', 'Saved with the slipnet:// export. Forwarded to compatible tunnel clients.')}</div>
                        </div>

                        {/* E2E mode */}
                        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                            <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer select-none font-bold">
                                <input type="checkbox" checked={e2eMode} onChange={e => setE2eMode(e.target.checked)} className="accent-amber-500" />
                                <span>{t('configLab.e2eMode', 'E2E mode')} <span className="text-xs font-normal text-amber-200/70">— {t('configLab.e2eModeHint', 'Resolve a target host through each DNS, then HTTP-fetch one of the IPs to validate full path')}</span></span>
                            </label>
                            {e2eMode && (
                                <div className="mt-2 flex items-center gap-2">
                                    <label className="text-xs text-amber-300">{t('configLab.e2eTarget', 'Target URL')}:</label>
                                    <input type="url" value={e2eTarget} onChange={e => setE2eTarget(e.target.value)} className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white font-mono" />
                                </div>
                            )}
                        </div>

                        {/* Tunnel mode */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('configLab.tunnelMode', 'Tunnel mode')}</label>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {PROTOCOL_MODES.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => setTunnelMode(m.id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${tunnelMode === m.id ? 'bg-indigo-500/25 border-indigo-500/50 text-indigo-200' : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'}`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Stealth presets */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('configLab.stealthPreset', 'Stealth (DNS query size + padding)')}</label>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {STEALTH_PRESETS.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setStealthPreset(p.id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${stealthPreset === p.id ? 'bg-purple-500/25 border-purple-500/50 text-purple-200' : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'}`}
                                    >
                                        {p.label}{p.padding ? ` +${p.padding} pad` : ''}
                                    </button>
                                ))}
                                <button
                                    onClick={() => setStealthPreset('custom')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${stealthPreset === 'custom' ? 'bg-purple-500/25 border-purple-500/50 text-purple-200' : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'}`}
                                >
                                    {t('configLab.custom', 'Custom')}
                                </button>
                            </div>
                            {stealthPreset === 'custom' && (
                                <div className="mt-2 flex flex-wrap gap-2 items-center">
                                    <label className="text-xs text-gray-500">{t('configLab.querySize', 'Query size (B)')}</label>
                                    <input type="number" value={customQuerySize} onChange={e => setCustomQuerySize(e.target.value)} min={20} max={250} className="w-20 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white" />
                                    <label className="text-xs text-gray-500">{t('configLab.padding', 'Padding (B)')}</label>
                                    <input type="number" value={customPadding} onChange={e => setCustomPadding(e.target.value)} min={0} max={100} className="w-20 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white" />
                                </div>
                            )}
                        </div>

                        {/* Direct mode */}
                        <div>
                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                                <input type="checkbox" checked={directMode} onChange={e => setDirectMode(e.target.checked)} className="accent-indigo-500" />
                                <span><strong>{t('configLab.directMode', 'Direct mode')}</strong> — <span className="text-xs text-gray-500">{t('configLab.directModeHint', 'Bypass recursive resolver, query authoritative NS directly (DNSTT/VayDNS only)')}</span></span>
                            </label>
                        </div>

                        {/* VayDNS knobs */}
                        {(tunnelMode === 'vaydns' || tunnelMode === 'auto') && (
                            <div className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/15">
                                <div className="text-xs font-bold text-cyan-300 mb-2">{t('configLab.vaydnsTuning', 'VayDNS tuning')}</div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-gray-500">{t('configLab.recordType', 'Record type')}</div>
                                        <select value={vayRecordType} onChange={e => setVayRecordType(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white">
                                            {RECORD_TYPES.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-gray-500">{t('configLab.maxQname', 'Max QNAME')}</div>
                                        <input type="number" min={50} max={253} value={vayMaxQname} onChange={e => setVayMaxQname(parseInt(e.target.value, 10) || 101)} className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white" />
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-gray-500">{t('configLab.rps', 'Rate (RPS)')}</div>
                                        <input type="number" min={0} max={1000} value={vayRps} onChange={e => setVayRps(parseInt(e.target.value, 10) || 0)} className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white" />
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-gray-500">{t('configLab.clientIdSize', 'ClientID (B)')}</div>
                                        <input type="number" min={1} max={8} value={vayClientIdSize} onChange={e => setVayClientIdSize(parseInt(e.target.value, 10) || 2)} className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white" />
                                    </div>
                                </div>
                                <div className="mt-2 text-[11px] text-cyan-200/70">
                                    {t('configLab.vaydnsHint', '0 = unlimited. These knobs are saved with the slipnet:// export and forwarded to compatible servers.')}
                                </div>
                            </div>
                        )}

                        {/* Export slipnet:// */}
                        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/[0.05]">
                            <button
                                onClick={exportSlipnet}
                                className="px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-xs font-bold flex items-center gap-1 border border-purple-500/30"
                            >
                                <Share2 className="w-3 h-3" /> {t('configLab.exportSlipnet', 'Export as slipnet:// (copy)')}
                            </button>
                            {shareUri && (
                                <code className="text-[10px] text-purple-300/80 truncate max-w-md">{shareUri.slice(0, 60)}…</code>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Run button */}
            <div className="flex items-center justify-center gap-3">
                {!running ? (
                    <button
                        onClick={runBattery}
                        disabled={!config.trim() || selectedResolvers.length === 0}
                        className="px-8 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white font-bold shadow-[0_0_30px_rgba(99,102,241,0.4)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <Zap className="w-5 h-5" />
                        {t('configLab.runBattery', 'Run Battery Test')}
                    </button>
                ) : (
                    <button onClick={stopBattery} className="px-8 py-3 rounded-2xl bg-red-500 hover:bg-red-400 text-white font-bold flex items-center gap-2 animate-pulse">
                        <X className="w-5 h-5" />
                        {t('configLab.stop', 'Stop')} ({progress.done}/{progress.total})
                    </button>
                )}
            </div>

            <div className="flex items-center justify-center">
                <label className="text-xs text-gray-300 flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={autoRunOnPaste}
                        onChange={(e) => setAutoRunOnPaste(e.target.checked)}
                        className="accent-emerald-500"
                    />
                    <span>
                        {t('configLab.autoRunOnPaste', 'Auto-run smart test after paste')}
                        <span className="text-gray-500"> — {t('configLab.autoRunOnPasteHint', 'When enabled, a test starts automatically ~0.6s after config changes')}</span>
                    </span>
                </label>
            </div>

            {running && (
                <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
                    <div className="text-xs text-gray-400 mb-2">{progress.label}</div>
                    <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                            style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Config Test Result */}
            {configResult && (
                <div className={`rounded-2xl p-5 border ${configOk ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                    <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                        <span className={configOk ? 'text-emerald-400' : 'text-red-400'}>{configOk ? '✓' : '✗'}</span>
                        {t('configLab.configResultTitle', 'Config test')}
                    </h4>
                    {configOk ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                            <Metric label={t('configLab.ping', 'Ping')} value={cfgMetrics.ping ? `${cfgMetrics.ping} ms` : '—'} />
                            <Metric label={t('configLab.jitter', 'Jitter')} value={cfgMetrics.jitter != null ? `${cfgMetrics.jitter} ms` : '—'} />
                            <Metric label={t('configLab.download', 'Download')} value={cfgMetrics.download ? `${cfgMetrics.download} Mbps` : '—'} />
                            <Metric label={t('configLab.upload', 'Upload')} value={cfgMetrics.upload ? `${cfgMetrics.upload} Mbps` : '—'} />
                        </div>
                    ) : (
                        <div className="text-sm text-red-300">{configResult.error || configResult.message || t('configLab.unknownError', 'Unknown error')}</div>
                    )}
                </div>
            )}

            {/* DNS Results */}
            {sortedDns.length > 0 && (
                <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
                    <h4 className="text-sm font-bold mb-3 text-gray-300">
                        {t('configLab.dnsResultsTitle', 'DNS resolver results')} ({t('configLab.host', 'Host')}: <span className="font-mono text-indigo-300">{effectiveTestHost}</span>)
                    </h4>

                    {bestDns && (
                        <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 flex items-center gap-3 flex-wrap">
                            <Crown className="w-6 h-6 text-yellow-400" />
                            <div className="flex-1 min-w-[200px]">
                                <div className="text-xs uppercase tracking-wider text-yellow-300 font-bold">{t('configLab.bestPairing', 'Recommended pairing')}</div>
                                <div className="text-sm text-white">
                                    {t('configLab.useDns', 'Use DNS')} <span className="font-mono font-bold text-yellow-200">{bestDns.resolver}</span> ({bestDns.name})
                                    {bestDns.protocol && <> {t('configLab.via', 'via')} <span className="font-bold uppercase text-yellow-200">{bestDns.protocol}</span></>}
                                    {' '}— {bestDns.latency ?? '?'} ms{bestDns.e2e ? ` (HTTP ${bestDns.httpStatus})` : `, score ${bestDns.score}/6`}
                                </div>
                            </div>
                            <button
                                onClick={() => copyText(bestDns.resolver)}
                                className="px-3 py-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 text-xs font-bold flex items-center gap-1 border border-yellow-500/30"
                            >
                                <Copy className="w-3 h-3" /> {t('configLab.copyDns', 'Copy DNS')}
                            </button>
                            {onSendToDeploy && (
                                <button
                                    onClick={applyBestToDeploy}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-200 text-xs font-bold flex items-center gap-1 border border-emerald-500/40"
                                    title={t('configLab.applyBestTip', 'Send these settings to the Deploy Wizard and switch to that tab')}
                                >
                                    🚀 {t('configLab.applyBest', 'Apply best to Deploy Wizard')}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-gray-500 border-b border-white/[0.05]">
                                    <th className="text-left py-2 px-2">#</th>
                                    <th className="text-left py-2 px-2">{t('configLab.resolver', 'Resolver')}</th>
                                    <th className="text-left py-2 px-2">{t('configLab.name', 'Name')}</th>
                                    <th className="text-center py-2 px-2">{t('configLab.proto', 'Proto')}</th>
                                    <th className="text-right py-2 px-2">{t('configLab.latency', 'Latency')}</th>
                                    <th className="text-center py-2 px-2">{t('configLab.score', 'Score')}</th>
                                    <th className="text-center py-2 px-2">{t('configLab.edns', 'EDNS')}</th>
                                    <th className="text-center py-2 px-2">{t('configLab.hijack', 'Hijack')}</th>
                                    <th className="text-left py-2 px-2">{t('configLab.status', 'Status')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedDns.map((r, i) => (
                                    <tr key={r.resolver} className={`border-b border-white/[0.03] hover:bg-white/[0.02] ${i === 0 && r.ok ? 'bg-yellow-500/5' : ''}`}>
                                        <td className="py-2 px-2 text-gray-500">{i + 1}</td>
                                        <td className="py-2 px-2 font-mono text-indigo-300">{r.resolver}</td>
                                        <td className="py-2 px-2 text-gray-300">{r.name}</td>
                                        <td className="py-2 px-2 text-center">
                                            {r.protocol ? (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase">{r.protocol}</span>
                                            ) : '—'}
                                        </td>
                                        <td className="py-2 px-2 text-right tabular-nums text-gray-200">{r.latency != null ? `${r.latency} ms` : '—'}</td>
                                        <td className="py-2 px-2 text-center">{r.ok ? <Score value={r.score || 0} /> : <span className="text-gray-600">—</span>}</td>
                                        <td className="py-2 px-2 text-center">{r.edns ? '✓' : '—'}</td>
                                        <td className="py-2 px-2 text-center">
                                            {r.hijack ? (
                                                <span title={t('configLab.hijackTip', 'NXDOMAIN hijacking detected — ISP redirects bad lookups (unsafe for tunneling)')} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 text-[10px] font-bold">
                                                    <ShieldAlert className="w-3 h-3" /> HIJACK
                                                </span>
                                            ) : r.ok ? (
                                                <span className="text-emerald-400/60 text-[10px]">✓ clean</span>
                                            ) : '—'}
                                        </td>
                                        <td className="py-2 px-2">
                                            {r.ok ? (
                                                <span className="text-emerald-400 text-xs">{t('configLab.ok', 'OK')}</span>
                                            ) : (
                                                <span className="text-red-400 text-xs" title={r.error}>{t('configLab.failed', 'Failed')}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-3 text-xs text-gray-500">
                        {t('configLab.tip', 'Tip: configure your OS/router DNS to the recommended resolver, then connect with the tested config for the best results in your network.')}
                    </div>
                </div>
            )}
        </div>
    );
}

function Metric({ label, value }) {
    return (
        <div className="bg-black/30 rounded-xl p-3 border border-white/[0.05]">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</div>
            <div className="text-base font-bold text-white tabular-nums">{value}</div>
        </div>
    );
}
