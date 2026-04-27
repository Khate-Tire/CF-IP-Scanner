/* Copyright (c) 2026 Khate Tire */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { Zap, Play, Square, Trophy, Copy, Download, Upload, Activity, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { speedMatrixStart, speedMatrixStatus, speedMatrixStop } from '../api';

const PRESET_RESOLVERS = [
    { ip: '1.1.1.1', name: 'Cloudflare' },
    { ip: '8.8.8.8', name: 'Google' },
    { ip: '9.9.9.9', name: 'Quad9' },
    { ip: '94.140.14.14', name: 'AdGuard' },
    { ip: '208.67.222.222', name: 'OpenDNS' },
    { ip: '178.22.122.100', name: 'Shecan' },
    { ip: '78.157.42.100', name: 'Electro' },
    { ip: '10.202.10.202', name: '403.online' },
    { ip: '185.51.200.2', name: 'Shecan 2' },
    { ip: '4.2.2.4', name: 'Level3' },
    { ip: '77.88.8.8', name: 'Yandex' },
    { ip: '223.5.5.5', name: 'AliDNS' },
];

const TRANSPORTS = [
    { id: 'udp', label: 'UDP/53' },
    { id: 'tcp', label: 'TCP/53' },
    { id: 'tls', label: 'DoT/853' },
    { id: 'https', label: 'DoH/443' },
];

function ScoreBadge({ value, max = 12 }) {
    const cls =
        value >= max * 0.75 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
        : value >= max * 0.5 ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
        : 'bg-red-500/20 text-red-300 border-red-500/40';
    return <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${cls}`}>{value}/{max}</span>;
}

function fmt(n, suffix = '') {
    if (n === null || n === undefined) return '—';
    if (typeof n === 'number') {
        if (n >= 100) return `${n.toFixed(0)}${suffix}`;
        if (n >= 10) return `${n.toFixed(1)}${suffix}`;
        return `${n.toFixed(2)}${suffix}`;
    }
    return `${n}${suffix}`;
}

export default function SpeedMatrix() {
    const { t } = useTranslation();
    const [configsText, setConfigsText] = useState('');
    const [selectedResolvers, setSelectedResolvers] = useState(['1.1.1.1', '8.8.8.8', '178.22.122.100']);
    const [selectedTransports, setSelectedTransports] = useState(['udp', 'tls', 'https']);
    const [customResolver, setCustomResolver] = useState('');
    const [extra, setExtra] = useState([]);
    const [running, setRunning] = useState(false);
    const [scanId, setScanId] = useState(null);
    const [status, setStatus] = useState(null);
    const [showAll, setShowAll] = useState(false);
    const [qrFor, setQrFor] = useState(null);
    const pollRef = useRef(null);

    const resolvers = useMemo(() => {
        const m = new Map();
        PRESET_RESOLVERS.forEach(r => m.set(r.ip, r));
        extra.forEach(ip => { if (!m.has(ip)) m.set(ip, { ip, name: 'Custom' }); });
        return Array.from(m.values());
    }, [extra]);

    const configs = useMemo(
        () => configsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
        [configsText]
    );

    const totalCombos = configs.length * selectedResolvers.length * selectedTransports.length;

    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    const toggleResolver = (ip) =>
        setSelectedResolvers(p => p.includes(ip) ? p.filter(x => x !== ip) : [...p, ip]);
    const toggleTransport = (id) =>
        setSelectedTransports(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

    const addCustomResolver = () => {
        const ip = customResolver.trim();
        if (!ip) return;
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
            toast.error(t('speedMatrix.invalidIp', 'Invalid IPv4 address'));
            return;
        }
        if (!extra.includes(ip) && !PRESET_RESOLVERS.some(r => r.ip === ip)) {
            setExtra(p => [...p, ip]);
        }
        if (!selectedResolvers.includes(ip)) setSelectedResolvers(p => [...p, ip]);
        setCustomResolver('');
    };

    const startScan = async () => {
        if (configs.length === 0) {
            toast.error(t('speedMatrix.noConfigs', 'Paste at least one config (one per line)'));
            return;
        }
        if (selectedResolvers.length === 0) {
            toast.error(t('speedMatrix.noResolvers', 'Select at least one DNS resolver'));
            return;
        }
        if (selectedTransports.length === 0) {
            toast.error(t('speedMatrix.noTransports', 'Select at least one DNS transport'));
            return;
        }
        setRunning(true);
        setStatus(null);
        setQrFor(null);
        try {
            const r = await speedMatrixStart({
                configs,
                resolvers: selectedResolvers,
                transports: selectedTransports,
            });
            if (r.error || !r.scan_id) {
                toast.error(r.error || t('speedMatrix.startFailed', 'Failed to start scan'));
                setRunning(false);
                return;
            }
            setScanId(r.scan_id);
            pollRef.current && clearInterval(pollRef.current);
            let consecutiveErrors = 0;
            pollRef.current = setInterval(async () => {
                try {
                    const s = await speedMatrixStatus(r.scan_id);
                    consecutiveErrors = 0;
                    setStatus(s);
                    if (s.status === 'completed' || s.status === 'cancelled') {
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                        setRunning(false);
                        if (s.status === 'completed' && s.best) {
                            toast.success(t('speedMatrix.done', 'Speed matrix complete — best result ready'));
                        }
                    }
                } catch (e) {
                    // Surface persistent failures instead of polling forever.
                    consecutiveErrors += 1;
                    if (consecutiveErrors >= 5) {
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                        setRunning(false);
                        toast.error(t('speedMatrix.pollFailed', 'Lost connection to speed-matrix scan') + `: ${String(e)}`);
                    }
                }
            }, 1500);
        } catch (e) {
            toast.error(String(e));
            setRunning(false);
        }
    };

    const stopScan = async () => {
        if (!scanId) return;
        try { await speedMatrixStop(scanId); } catch { /* ignore */ }
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setRunning(false);
    };

    const copy = (txt) => {
        try {
            navigator.clipboard.writeText(txt);
            toast.success(t('common.copied', 'Copied'));
        } catch {
            toast.error(t('common.copyFailed', 'Copy failed'));
        }
    };

    const ranked = status?.results || [];
    const visible = showAll ? ranked : ranked.slice(0, 12);
    const best = status?.best;

    return (
        <div className="space-y-6">
            <div className="glass-panel p-6 neon-border relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-[100px] pointer-events-none" />
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                        <Zap className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-orange-200">
                            {t('speedMatrix.title', 'Speed Matrix')}
                        </h2>
                        <p className="text-sm text-gray-400">
                            {t('speedMatrix.subtitle', 'Test upload/download of every config across every DNS scenario and pick the winner')}
                        </p>
                    </div>
                </div>

                {/* Configs */}
                <div className="mb-4">
                    <label className="block text-sm text-gray-300 mb-2 font-semibold">
                        {t('speedMatrix.configs', 'Configs (one per line — vless://, vmess://, trojan://, ss://, slipnet://)')}
                    </label>
                    <textarea
                        className="w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-3 text-white text-xs focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none font-mono h-32 resize-y"
                        value={configsText}
                        onChange={e => setConfigsText(e.target.value)}
                        placeholder={'vless://uuid@host:443?...\nvmess://eyJ2...\ntrojan://...\nslipnet://eDE4fGRuc3R0fC4uLg=='}
                        disabled={running}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        {configs.length} {t('speedMatrix.configsLoaded', 'config(s) loaded')}
                    </p>
                    <p className="text-[11px] text-amber-300/80 mt-1">
                        {t('speedMatrix.slipnetNote', 'slipnet:// configs are tested against every selected DNS resolver — download/upload Mbps are estimated from DNS RTT (MTU/RTT model), and the QR re-encodes the URI with the winning resolver so it imports straight into the SlipNet app.')}
                    </p>
                </div>

                {/* Resolvers */}
                <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-sm text-gray-300 font-semibold">
                            {t('speedMatrix.resolvers', 'DNS Resolvers')} ({selectedResolvers.length})
                        </label>
                        <div className="flex gap-2">
                            <button type="button" disabled={running}
                                onClick={() => setSelectedResolvers(resolvers.map(r => r.ip))}
                                className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 disabled:opacity-50">
                                {t('speedMatrix.selectAll', 'Select all')}
                            </button>
                            <button type="button" disabled={running}
                                onClick={() => setSelectedResolvers([])}
                                className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 disabled:opacity-50">
                                {t('speedMatrix.clear', 'Clear')}
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto p-2 bg-black/30 rounded-lg border border-gray-800">
                        {resolvers.map(r => {
                            const active = selectedResolvers.includes(r.ip);
                            return (
                                <button key={r.ip} type="button" disabled={running} onClick={() => toggleResolver(r.ip)}
                                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${active
                                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'
                                        } disabled:opacity-50`}>
                                    <span className="font-mono">{r.ip}</span>
                                    <span className="opacity-60 ml-1">{r.name}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="mt-2 flex gap-2">
                        <input className="flex-1 bg-[#0d0d12] border border-gray-700 rounded-lg px-3 py-2 text-white text-xs font-mono"
                            placeholder="1.2.3.4" value={customResolver}
                            onChange={e => setCustomResolver(e.target.value)} disabled={running} />
                        <button type="button" disabled={running} onClick={addCustomResolver}
                            className="px-3 py-2 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-xs text-violet-300 disabled:opacity-50">
                            {t('speedMatrix.addCustom', 'Add custom')}
                        </button>
                    </div>
                </div>

                {/* Transports */}
                <div className="mb-4">
                    <label className="text-sm text-gray-300 font-semibold mb-2 block">
                        {t('speedMatrix.transports', 'DNS Transports')} ({selectedTransports.length})
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {TRANSPORTS.map(t2 => {
                            const active = selectedTransports.includes(t2.id);
                            return (
                                <button key={t2.id} type="button" disabled={running} onClick={() => toggleTransport(t2.id)}
                                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${active
                                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'
                                        } disabled:opacity-50`}>
                                    {t2.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Action bar */}
                <div className="flex items-center justify-between gap-3 mt-6">
                    <div className="text-xs text-gray-400">
                        {t('speedMatrix.totalCombos', 'Total combinations')}:{' '}
                        <span className="text-amber-300 font-bold">{totalCombos}</span>
                        <span className="opacity-60 ml-2">
                            ({configs.length} × {selectedResolvers.length} × {selectedTransports.length})
                        </span>
                    </div>
                    {!running ? (
                        <button onClick={startScan}
                            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold shadow-[0_0_20px_rgba(245,158,11,0.4)] flex items-center gap-2">
                            <Play className="w-4 h-4" />
                            {t('speedMatrix.start', 'Start matrix scan')}
                        </button>
                    ) : (
                        <button onClick={stopScan}
                            className="px-5 py-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 font-bold flex items-center gap-2">
                            <Square className="w-4 h-4" />
                            {t('speedMatrix.stop', 'Stop')}
                        </button>
                    )}
                </div>

                {/* Progress */}
                {status && (
                    <div className="mt-4">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>{status.label || status.status}</span>
                            <span>{status.completed}/{status.total} ({status.progress}%) — {status.elapsed_sec}s</span>
                        </div>
                        <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                            <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all"
                                style={{ width: `${Math.min(status.progress || 0, 100)}%` }} />
                        </div>
                    </div>
                )}
            </div>

            {/* Best result */}
            {best && (
                <div className="glass-panel p-6 border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent">
                    <div className="flex items-center gap-3 mb-4">
                        <Trophy className="w-6 h-6 text-emerald-400" />
                        <h3 className="text-xl font-bold text-emerald-300">
                            {t('speedMatrix.bestTitle', 'Best combination')}
                        </h3>
                        <ScoreBadge value={best.score} />
                        {best.kind === 'slipnet' && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                slipnet
                            </span>
                        )}
                        {best.estimated && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30" title={t('speedMatrix.estimatedTip', 'Mbps estimated from DNS round-trip (MTU/RTT model)')}>
                                {t('speedMatrix.estimated', 'estimated')}
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase">{t('speedMatrix.config', 'Config')}</div>
                                    <div className="text-white font-mono text-xs truncate">{best.config_label}</div>
                                </div>
                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase">{t('speedMatrix.dns', 'DNS')}</div>
                                    <div className="text-cyan-300 font-mono">{best.resolver}</div>
                                    <div className="text-[10px] text-gray-500">{best.transport?.toUpperCase()}</div>
                                </div>
                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase flex items-center gap-1"><Download className="w-3 h-3"/>{t('speedMatrix.download', 'Download')}</div>
                                    <div className="text-emerald-300 font-bold">{fmt(best.download_mbps, ' Mbps')}</div>
                                </div>
                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase flex items-center gap-1"><Upload className="w-3 h-3"/>{t('speedMatrix.upload', 'Upload')}</div>
                                    <div className="text-blue-300 font-bold">{fmt(best.upload_mbps, ' Mbps')}</div>
                                </div>
                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase flex items-center gap-1"><Activity className="w-3 h-3"/>{t('speedMatrix.ping', 'Ping')}</div>
                                    <div className="text-white">{fmt(best.ping_ms, ' ms')}</div>
                                </div>
                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase">{t('speedMatrix.jitter', 'Jitter')}</div>
                                    <div className="text-white">{fmt(best.jitter_ms, ' ms')}</div>
                                </div>
                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase">{t('speedMatrix.dnsLat', 'DNS lat.')}</div>
                                    <div className="text-white">{fmt(best.dns_latency_ms, ' ms')}</div>
                                </div>
                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase">{t('speedMatrix.httpLat', 'HTTP lat.')}</div>
                                    <div className="text-white">{fmt(best.http_latency_ms, ' ms')}</div>
                                </div>
                            </div>
                            <div className="bg-black/40 rounded-lg p-3 border border-white/5">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase text-gray-500">{t('speedMatrix.qrPayload', 'QR / share payload')}</span>
                                    <button onClick={() => copy(best.qr_payload)} className="text-xs text-amber-300 hover:text-amber-200 flex items-center gap-1">
                                        <Copy className="w-3 h-3"/>{t('common.copy', 'Copy')}
                                    </button>
                                </div>
                                <div className="text-xs font-mono break-all text-gray-300 max-h-20 overflow-y-auto">
                                    {best.qr_payload}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col items-center justify-center gap-2 bg-white p-4 rounded-xl">
                            <QRCodeSVG value={best.qr_payload || best.config || ''} size={180} level="M" />
                            <span className="text-[10px] text-gray-700 font-mono">{best.resolver} / {best.transport?.toUpperCase()}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Ranked table */}
            {ranked.length > 0 && (
                <div className="glass-panel p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Globe className="w-4 h-4 text-cyan-400" />
                            {t('speedMatrix.rankings', 'Rankings')} ({ranked.length})
                        </h3>
                        <button onClick={() => setShowAll(s => !s)} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 flex items-center gap-1">
                            {showAll ? <><ChevronUp className="w-3 h-3"/>{t('speedMatrix.showTop', 'Show top 12')}</> : <><ChevronDown className="w-3 h-3"/>{t('speedMatrix.showAll', 'Show all')}</>}
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-gray-400 border-b border-white/10">
                                    <th className="py-2 px-2">#</th>
                                    <th className="py-2 px-2">{t('speedMatrix.score', 'Score')}</th>
                                    <th className="py-2 px-2">{t('speedMatrix.config', 'Config')}</th>
                                    <th className="py-2 px-2">{t('speedMatrix.dns', 'DNS')}</th>
                                    <th className="py-2 px-2">T</th>
                                    <th className="py-2 px-2 text-right">DL</th>
                                    <th className="py-2 px-2 text-right">UL</th>
                                    <th className="py-2 px-2 text-right">Ping</th>
                                    <th className="py-2 px-2 text-right">DNS ms</th>
                                    <th className="py-2 px-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((r, i) => (
                                    <tr key={i} className={`border-b border-white/5 hover:bg-white/[0.03] ${i === 0 ? 'bg-emerald-500/5' : ''}`}>
                                        <td className="py-2 px-2 text-gray-500">{i + 1}</td>
                                        <td className="py-2 px-2"><ScoreBadge value={r.score} /></td>
                                        <td className="py-2 px-2 font-mono text-gray-300 truncate max-w-[160px]">
                                            <span className="inline-flex items-center gap-1">
                                                {r.kind === 'slipnet' && (
                                                    <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">slip</span>
                                                )}
                                                {r.estimated && (
                                                    <span className="text-[9px] px-1 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30" title={t('speedMatrix.estimatedTip', 'Mbps estimated from DNS round-trip (MTU/RTT model)')}>est</span>
                                                )}
                                                <span className="truncate">{r.config_label}</span>
                                            </span>
                                        </td>
                                        <td className="py-2 px-2 font-mono text-cyan-300">{r.resolver}</td>
                                        <td className="py-2 px-2 text-gray-400">{r.transport?.toUpperCase()}</td>
                                        <td className="py-2 px-2 text-right text-emerald-300">{fmt(r.download_mbps)}</td>
                                        <td className="py-2 px-2 text-right text-blue-300">{fmt(r.upload_mbps)}</td>
                                        <td className="py-2 px-2 text-right text-gray-300">{fmt(r.ping_ms)}</td>
                                        <td className="py-2 px-2 text-right text-gray-300">{fmt(r.dns_latency_ms)}</td>
                                        <td className="py-2 px-2 text-right space-x-1 whitespace-nowrap">
                                            <button onClick={() => copy(r.qr_payload)} className="text-amber-400 hover:text-amber-300" title={t('common.copy', 'Copy')}>
                                                <Copy className="w-3.5 h-3.5 inline"/>
                                            </button>
                                            <button onClick={() => setQrFor(r)} className="text-cyan-400 hover:text-cyan-300 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30">
                                                QR
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* QR modal */}
            {qrFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setQrFor(null)}>
                    <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h4 className="font-bold text-white">{qrFor.config_label} · {qrFor.resolver}/{qrFor.transport?.toUpperCase()}</h4>
                            <button onClick={() => setQrFor(null)} className="text-gray-400 hover:text-white text-xl">×</button>
                        </div>
                        <div className="bg-white p-4 rounded-xl flex items-center justify-center">
                            <QRCodeSVG value={qrFor.qr_payload || qrFor.config || ''} size={280} level="M" />
                        </div>
                        <div className="mt-3 text-[10px] font-mono break-all text-gray-400 max-h-24 overflow-y-auto bg-black/40 rounded p-2">
                            {qrFor.qr_payload}
                        </div>
                        <button onClick={() => copy(qrFor.qr_payload)}
                            className="mt-3 w-full px-3 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-200 text-sm font-bold flex items-center justify-center gap-2">
                            <Copy className="w-4 h-4"/>{t('common.copy', 'Copy')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
