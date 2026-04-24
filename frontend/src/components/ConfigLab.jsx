/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { FlaskConical, Copy, Trash2, Plus, Zap, Crown, Globe, X } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { testConfigRemote, dnsQuickTest } from '../api';

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

export default function ConfigLab() {
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

    const detectedHost = useMemo(() => extractHostFromConfig(config), [config]);
    const protocol = useMemo(() => detectProtocol(config), [config]);
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

    const runBattery = async () => {
        if (!config.trim()) {
            toast.error(t('configLab.noConfig', 'Paste a config first'));
            return;
        }
        if (selectedResolvers.length === 0) {
            toast.error(t('configLab.noResolvers', 'Select at least one DNS resolver'));
            return;
        }
        const host = detectedHost || 'cloudflare.com';
        cancelRef.current = false;
        setRunning(true);
        setConfigResult(null);
        setDnsResults([]);
        setProgress({ done: 0, total: selectedResolvers.length + 1, label: t('configLab.testingConfig', 'Testing config…') });

        // 1) Test the config itself (full speed test via backend)
        try {
            const r = await testConfigRemote(config.trim());
            setConfigResult(r);
            if (!r.success) {
                toast.error(`${t('configLab.configFailed', 'Config test failed')}: ${r.error || r.message || 'unknown'}`);
            }
        } catch (e) {
            setConfigResult({ success: false, error: String(e?.message || e) });
        }
        setProgress(p => ({ ...p, done: 1, label: t('configLab.testingDns', 'Testing DNS resolvers…') }));

        // 2) Test each selected DNS resolver against the config's host
        const results = [];
        for (let i = 0; i < selectedResolvers.length; i++) {
            if (cancelRef.current) break;
            const ip = selectedResolvers[i];
            const meta = allResolvers.find(r => r.ip === ip) || { name: 'Custom' };
            try {
                const res = await dnsQuickTest(ip, host);
                results.push({
                    resolver: ip,
                    name: meta.name,
                    tag: meta.tag,
                    latency: res?.latency_ms ?? res?.latency ?? null,
                    score: res?.score ?? 0,
                    edns: res?.edns ?? false,
                    answers: res?.answers ?? [],
                    ok: res?.ok !== false && (res?.latency_ms ?? res?.latency) != null,
                    raw: res,
                });
            } catch (e) {
                results.push({ resolver: ip, name: meta.name, tag: meta.tag, ok: false, error: String(e?.message || e) });
            }
            setDnsResults([...results]);
            setProgress(p => ({ ...p, done: 2 + i }));
        }

        setRunning(false);
        setProgress({ done: 0, total: 0, label: '' });
        if (!cancelRef.current) {
            toast.success(t('configLab.batteryDone', 'Battery test complete'));
        }
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
                        <button
                            onClick={() => setConfig('')}
                            className="ml-auto text-xs text-gray-500 hover:text-red-400 flex items-center gap-1"
                        >
                            <Trash2 className="w-3 h-3" /> {t('configLab.clear', 'Clear')}
                        </button>
                    </div>
                )}
            </div>

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
                        {t('configLab.dnsResultsTitle', 'DNS resolver results')} ({t('configLab.host', 'Host')}: <span className="font-mono text-indigo-300">{detectedHost || 'cloudflare.com'}</span>)
                    </h4>

                    {bestDns && (
                        <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 flex items-center gap-3 flex-wrap">
                            <Crown className="w-6 h-6 text-yellow-400" />
                            <div className="flex-1 min-w-[200px]">
                                <div className="text-xs uppercase tracking-wider text-yellow-300 font-bold">{t('configLab.bestPairing', 'Recommended pairing')}</div>
                                <div className="text-sm text-white">
                                    {t('configLab.useDns', 'Use DNS')} <span className="font-mono font-bold text-yellow-200">{bestDns.resolver}</span> ({bestDns.name})
                                    {' '}— {bestDns.latency ?? '?'} ms, score {bestDns.score}/6
                                </div>
                            </div>
                            <button
                                onClick={() => copyText(bestDns.resolver)}
                                className="px-3 py-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 text-xs font-bold flex items-center gap-1 border border-yellow-500/30"
                            >
                                <Copy className="w-3 h-3" /> {t('configLab.copyDns', 'Copy DNS')}
                            </button>
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-gray-500 border-b border-white/[0.05]">
                                    <th className="text-left py-2 px-2">#</th>
                                    <th className="text-left py-2 px-2">{t('configLab.resolver', 'Resolver')}</th>
                                    <th className="text-left py-2 px-2">{t('configLab.name', 'Name')}</th>
                                    <th className="text-right py-2 px-2">{t('configLab.latency', 'Latency')}</th>
                                    <th className="text-center py-2 px-2">{t('configLab.score', 'Score')}</th>
                                    <th className="text-center py-2 px-2">{t('configLab.edns', 'EDNS')}</th>
                                    <th className="text-left py-2 px-2">{t('configLab.status', 'Status')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedDns.map((r, i) => (
                                    <tr key={r.resolver} className={`border-b border-white/[0.03] hover:bg-white/[0.02] ${i === 0 && r.ok ? 'bg-yellow-500/5' : ''}`}>
                                        <td className="py-2 px-2 text-gray-500">{i + 1}</td>
                                        <td className="py-2 px-2 font-mono text-indigo-300">{r.resolver}</td>
                                        <td className="py-2 px-2 text-gray-300">{r.name}</td>
                                        <td className="py-2 px-2 text-right tabular-nums text-gray-200">{r.latency != null ? `${r.latency} ms` : '—'}</td>
                                        <td className="py-2 px-2 text-center">{r.ok ? <Score value={r.score || 0} /> : <span className="text-gray-600">—</span>}</td>
                                        <td className="py-2 px-2 text-center">{r.edns ? '✓' : '—'}</td>
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
