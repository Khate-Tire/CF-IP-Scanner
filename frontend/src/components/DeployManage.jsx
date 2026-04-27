/* Copyright (c) 2026 Khate Tire */
/**
 * DeployManage — manage an EXISTING dnstm install on a remote VPS.
 * Workflow: SSH-connect (re-uses tunnelConnect from api.js) → status →
 * restart / users / update / uninstall. Persists last-known host in
 * localStorage so reconnects are one click.
 */
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from '../i18n/LanguageContext';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import {
    tunnelConnect, tunnelDisconnect,
    tunnelManageStatus, tunnelManageRestart,
    tunnelManageUsersList, tunnelManageUserAdd, tunnelManageUserRemove,
    tunnelManageUpdate, tunnelManageUninstall,
    tunnelScanResolvers,
    tunnelInstallNaive, tunnelInstallStunTls, tunnelToggleWarp, tunnelLiveMetrics,
} from '../api';

const LS_KEY = 'dnstun.lastHost';

export default function DeployManage() {
    const { t } = useTranslation();
    const persisted = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } })();

    const [host, setHost] = useState(persisted.host || '');
    const [port, setPort] = useState(persisted.port || 22);
    const [username, setUsername] = useState(persisted.username || 'root');
    const [authMode, setAuthMode] = useState(persisted.authMode || 'password');
    const [password, setPassword] = useState('');
    const [privateKey, setPrivateKey] = useState('');
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);

    const [status, setStatus] = useState(null);
    const [statusLoading, setStatusLoading] = useState(false);
    const [users, setUsers] = useState([]);
    const [newUser, setNewUser] = useState('');
    const [newPass, setNewPass] = useState('');
    const [busyAction, setBusyAction] = useState(null); // string identifier of running action

    // Resolver scanner state
    const [scanDomain, setScanDomain] = useState(persisted.domain || '');
    const [scanResults, setScanResults] = useState(null);
    const [scanning, setScanning] = useState(false);

    // Phase 4 — add-ons state
    const [naiveDomain, setNaiveDomain] = useState(persisted.domain || '');
    const [naiveUser, setNaiveUser] = useState('proxy');
    const [naivePass, setNaivePass] = useState('');
    const [warpEnabled, setWarpEnabled] = useState(false);
    const [naiveResult, setNaiveResult] = useState(null);
    const [stunResult, setStunResult] = useState(null);

    // Live dashboard
    const [liveOn, setLiveOn] = useState(false);
    const [history, setHistory] = useState([]); // {ts, rxKbps, txKbps, tcp, load}
    useEffect(() => {
        if (!connected || !liveOn) return;
        let prev = null;
        const id = setInterval(async () => {
            const m = await tunnelLiveMetrics();
            if (!m?.success) return;
            let rxKbps = 0, txKbps = 0;
            if (prev) {
                const dt = (m.ts - prev.ts) || 1;
                rxKbps = Math.max(0, (m.rx_bytes - prev.rx_bytes) * 8 / 1000 / dt);
                txKbps = Math.max(0, (m.tx_bytes - prev.tx_bytes) * 8 / 1000 / dt);
            }
            prev = m;
            setHistory(h => {
                const next = [...h, { t: new Date(m.ts * 1000).toLocaleTimeString().slice(-5), rx: Math.round(rxKbps), tx: Math.round(txKbps), tcp: m.tcp_established, load: m.load1, mem: m.mem_used_mb, memTotal: m.mem_total_mb, dnstm: m.dnstm_processes }];
                return next.slice(-30);
            });
        }, 2000);
        return () => clearInterval(id);
    }, [connected, liveOn]);

    const ic = "w-full bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";

    const persist = useCallback(() => {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({ host, port, username, authMode }));
        } catch { /* ignore */ }
    }, [host, port, username, authMode]);

    const refreshStatus = useCallback(async () => {
        setStatusLoading(true);
        try {
            const s = await tunnelManageStatus();
            setStatus(s);
            if (s?.success && s?.installed) {
                const u = await tunnelManageUsersList();
                if (u?.success) setUsers(u.users || []);
            }
        } finally { setStatusLoading(false); }
    }, []);

    const doConnect = async (acceptNewHostKey = false) => {
        if (!host || !username) { toast.error('Host and username required'); return; }
        if (authMode === 'password' && !password) { toast.error('Password required'); return; }
        if (authMode === 'key' && !privateKey) { toast.error('Private key required'); return; }
        setConnecting(true);
        try {
            const r = await tunnelConnect(
                host,
                Number(port) || 22,
                username,
                authMode === 'password' ? password : null,
                authMode === 'key' ? privateKey : null,
                { acceptNewHostKey },
            );
            if (r?.success) {
                setConnected(true);
                persist();
                toast.success(`Connected to ${host}`);
                await refreshStatus();
            } else if (r?.code === 'host_key_mismatch') {
                const accept = window.confirm(
                    (r.message || "The server's SSH host key has changed.") +
                    '\n\nTrust the new key and reconnect?'
                );
                if (accept) {
                    setConnecting(false);
                    return doConnect(true);
                }
                toast.error(r.message);
            } else {
                toast.error(r?.message || 'Connection failed');
            }
        } catch (e) {
            toast.error(String(e?.message || e));
        } finally { setConnecting(false); }
    };

    const doDisconnect = async () => {
        await tunnelDisconnect();
        setConnected(false);
        setStatus(null);
        setUsers([]);
        toast.success('Disconnected');
    };

    const doAction = async (key, fn, confirmMsg) => {
        if (confirmMsg && !confirm(confirmMsg)) return;
        setBusyAction(key);
        try {
            const r = await fn();
            if (r?.success) toast.success(r?.message || `${key} ok`);
            else toast.error(r?.message || `${key} failed`);
            await refreshStatus();
            return r;
        } catch (e) { toast.error(String(e?.message || e)); }
        finally { setBusyAction(null); }
    };

    const doAddUser = async () => {
        if (!newUser || !newPass) { toast.error('Username and password required'); return; }
        const r = await doAction('user-add', () => tunnelManageUserAdd(newUser, newPass));
        if (r?.success) { setNewUser(''); setNewPass(''); }
    };

    return (
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 space-y-4">
            <div>
                <h3 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
                    🛠 {t('dnsTunnel.manageTitle', 'Manage existing deployment')}
                </h3>
                <p className="text-gray-400 text-sm mt-1">
                    {t('dnsTunnel.manageDesc', 'Connect to a VPS that already runs dnstm to check status, restart, manage users, update, or uninstall.')}
                </p>
            </div>

            {/* Connect form */}
            {!connected && (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2 sm:col-span-1">
                            <label className="text-xs text-gray-400 block mb-1">Host / IP</label>
                            <input className={ic} value={host} onChange={e => setHost(e.target.value)} placeholder="1.2.3.4" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">Port</label>
                            <input className={ic} type="number" value={port} onChange={e => setPort(e.target.value)} />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">User</label>
                            <input className={ic} value={username} onChange={e => setUsername(e.target.value)} />
                        </div>
                    </div>
                    <div className="flex gap-2 text-xs">
                        <button onClick={() => setAuthMode('password')} className={`px-3 py-1.5 rounded-md ${authMode === 'password' ? 'bg-emerald-500 text-black font-bold' : 'bg-gray-800 text-gray-400'}`}>Password</button>
                        <button onClick={() => setAuthMode('key')} className={`px-3 py-1.5 rounded-md ${authMode === 'key' ? 'bg-emerald-500 text-black font-bold' : 'bg-gray-800 text-gray-400'}`}>SSH Key</button>
                    </div>
                    {authMode === 'password' ? (
                        <input className={ic} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="SSH password" />
                    ) : (
                        <textarea className={ic + ' h-24 font-mono text-[11px]'} value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                    )}
                    <button
                        onClick={doConnect}
                        disabled={connecting}
                        className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-bold text-sm hover:brightness-110 disabled:opacity-50"
                    >
                        {connecting ? 'Connecting…' : `🔌 Connect & probe`}
                    </button>
                </div>
            )}

            {/* Connected — show actions */}
            {connected && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-emerald-400 font-bold">● Connected to {host}</span>
                        <button onClick={doDisconnect} className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded bg-gray-800">Disconnect</button>
                    </div>

                    {/* Status panel */}
                    <div className="p-3 rounded-lg bg-black/40 border border-gray-800 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-cyan-300 font-bold text-xs uppercase tracking-wider">Status</span>
                            <button onClick={refreshStatus} disabled={statusLoading} className="text-[10px] text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
                                {statusLoading ? '…' : '🔄 Refresh'}
                            </button>
                        </div>
                        {!status && <p className="text-gray-500 text-xs italic">Press Refresh to probe.</p>}
                        {status && status.installed === false && (
                            <p className="text-amber-300 text-xs">⚠ dnstm not installed on this host. Use the Deploy tab first.</p>
                        )}
                        {status && status.installed && (
                            <div className="text-xs text-gray-300 space-y-1">
                                <div><span className="text-gray-500">Version: </span><span className="font-mono">{status.version || '?'}</span></div>
                                {status.active_since && <div><span className="text-gray-500">Active since: </span>{status.active_since}</div>}
                                {status.units?.length > 0 && (
                                    <div>
                                        <div className="text-gray-500">Services:</div>
                                        <pre className="font-mono text-[10px] text-emerald-300 whitespace-pre-wrap">{status.units.join('\n')}</pre>
                                    </div>
                                )}
                                {status.tunnels && (
                                    <details>
                                        <summary className="cursor-pointer text-gray-400">Tunnels (dnstm tunnel list)</summary>
                                        <pre className="font-mono text-[10px] text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto">{status.tunnels}</pre>
                                    </details>
                                )}
                                {status.listening && (
                                    <details>
                                        <summary className="cursor-pointer text-gray-400">Listening sockets</summary>
                                        <pre className="font-mono text-[10px] text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto">{status.listening}</pre>
                                    </details>
                                )}
                            </div>
                        )}
                    </div>

                    {/* User management */}
                    {status?.installed && (
                        <div className="p-3 rounded-lg bg-black/40 border border-gray-800 space-y-2">
                            <span className="text-cyan-300 font-bold text-xs uppercase tracking-wider">SSH-tunnel users</span>
                            {users.length === 0 ? (
                                <p className="text-gray-500 text-xs italic">No users yet.</p>
                            ) : (
                                <ul className="text-xs space-y-1">
                                    {users.map(u => (
                                        <li key={u} className="flex items-center justify-between bg-gray-900/40 rounded px-2 py-1">
                                            <span className="font-mono text-gray-300">{u}</span>
                                            <button
                                                onClick={() => doAction('user-rm', () => tunnelManageUserRemove(u), `Remove user "${u}"?`)}
                                                disabled={busyAction === 'user-rm'}
                                                className="text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20"
                                            >Remove</button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className="flex gap-2">
                                <input className={ic + ' flex-1'} placeholder="username" value={newUser} onChange={e => setNewUser(e.target.value)} />
                                <input className={ic + ' flex-1'} type="password" placeholder="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
                                <button
                                    onClick={doAddUser}
                                    disabled={busyAction === 'user-add'}
                                    className="px-3 py-2 rounded-lg bg-emerald-500 text-black font-bold text-xs hover:bg-emerald-400 disabled:opacity-50"
                                >+ Add</button>
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    {status?.installed && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <button
                                onClick={() => doAction('restart', tunnelManageRestart)}
                                disabled={!!busyAction}
                                className="py-2 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs font-bold hover:bg-blue-500/30 disabled:opacity-50"
                            >{busyAction === 'restart' ? '…' : '🔄 Restart services'}</button>
                            <button
                                onClick={() => doAction('update', tunnelManageUpdate, 'Download latest dnstm and restart? (~30 s)')}
                                disabled={!!busyAction}
                                className="py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs font-bold hover:bg-violet-500/30 disabled:opacity-50"
                            >{busyAction === 'update' ? '…' : '⬆ Update binary'}</button>
                            <button
                                onClick={() => doAction('uninstall', tunnelManageUninstall, 'PERMANENTLY uninstall dnstm? Tunnels will stop. Continue?')}
                                disabled={!!busyAction}
                                className="py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold hover:bg-red-500/30 disabled:opacity-50"
                            >{busyAction === 'uninstall' ? '…' : '🗑 Uninstall'}</button>
                        </div>
                    )}
                </div>
            )}

            {/* Resolver scanner — works even when not SSH-connected */}
            <div className="p-3 rounded-lg bg-black/30 border border-emerald-900/40 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-emerald-300 font-bold text-xs uppercase tracking-wider">
                        🔭 {t('dnsTunnel.resolverScanTitle', 'Find best DNS resolvers for your tunnel')}
                    </span>
                </div>
                <p className="text-gray-500 text-[11px]">
                    {t('dnsTunnel.resolverScanDesc', 'Probes ~40 public resolvers (Cloudflare, Google, Quad9, AdGuard, regional…) to find which ones can reach your tunnel domain on UDP/53. Use the top results in the SlipNet client when your ISP DNS is hijacked.')}
                </p>
                <div className="flex gap-2">
                    <input
                        className={ic + ' flex-1'}
                        value={scanDomain}
                        onChange={e => setScanDomain(e.target.value)}
                        placeholder="tunnel.example.com"
                    />
                    <button
                        onClick={async () => {
                            if (!scanDomain || !scanDomain.includes('.')) { toast.error('Enter a valid domain'); return; }
                            setScanning(true); setScanResults(null);
                            try {
                                const r = await tunnelScanResolvers(scanDomain.trim(), 12, 2.5);
                                if (!r?.success) toast.error(r?.message || 'Scan failed');
                                else { setScanResults(r); toast.success(`Found ${r.ok_count}/${r.total} working`); }
                            } catch (e) { toast.error(String(e?.message || e)); }
                            finally { setScanning(false); }
                        }}
                        disabled={scanning}
                        className="px-4 py-2 rounded-lg bg-emerald-500 text-black font-bold text-xs hover:bg-emerald-400 disabled:opacity-50"
                    >{scanning ? 'Scanning…' : '🔍 Scan'}</button>
                </div>
                {scanResults && (
                    <div className="mt-2">
                        <p className="text-[11px] text-gray-500 mb-1">
                            {scanResults.ok_count}/{scanResults.total} resolvers responded — top {Math.min(12, scanResults.results.length)}:
                        </p>
                        <div className="rounded bg-black/40 border border-gray-800 overflow-hidden">
                            <table className="w-full text-[11px]">
                                <thead className="bg-gray-900/60 text-gray-400">
                                    <tr><th className="text-left px-2 py-1">#</th><th className="text-left px-2 py-1">Resolver</th><th className="text-right px-2 py-1">Latency</th><th className="text-left px-2 py-1">Status</th><th className="px-2 py-1"></th></tr>
                                </thead>
                                <tbody>
                                    {scanResults.results.slice(0, 12).map((r, i) => (
                                        <tr key={r.resolver} className={`border-t border-gray-800 ${r.ok ? '' : 'opacity-50'}`}>
                                            <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                                            <td className="px-2 py-1 font-mono text-gray-300">{r.resolver}</td>
                                            <td className="px-2 py-1 text-right font-mono">
                                                {r.latency_ms != null ? `${r.latency_ms} ms` : '—'}
                                            </td>
                                            <td className="px-2 py-1">
                                                {r.ok
                                                    ? <span className="text-emerald-400">✓ {r.error || 'ok'}</span>
                                                    : <span className="text-red-400">✗ {r.error || 'fail'}</span>}
                                            </td>
                                            <td className="px-2 py-1 text-right">
                                                <button onClick={() => { navigator.clipboard.writeText(r.resolver); toast.success('Copied'); }} className="text-[10px] text-gray-500 hover:text-white">📋</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {scanResults.top?.length > 0 && (
                            <button
                                onClick={() => {
                                    const list = scanResults.top.filter(r => r.ok).map(r => r.resolver).join(',');
                                    navigator.clipboard.writeText(list);
                                    toast.success(`Copied ${list.split(',').length} resolvers`);
                                }}
                                className="mt-2 w-full py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold hover:bg-emerald-500/30"
                            >📋 Copy top resolvers (comma-separated, paste into SlipNet)</button>
                        )}
                    </div>
                )}
            </div>

            {/* Phase 4 — Live dashboard (only when SSH-connected) */}
            {connected && (
                <div className="p-3 rounded-lg bg-black/30 border border-violet-900/40 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-violet-300 font-bold text-xs uppercase tracking-wider">📊 {t('dnsTunnel.liveTitle', 'Live dashboard')}</span>
                        <button onClick={() => { setLiveOn(v => !v); if (liveOn) setHistory([]); }}
                            className={`text-[10px] px-2 py-1 rounded ${liveOn ? 'bg-violet-500 text-black font-bold' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                            {liveOn ? '⏸ Pause' : '▶ Start'}
                        </button>
                    </div>
                    {liveOn && history.length === 0 && <p className="text-gray-500 text-xs italic">Sampling…</p>}
                    {history.length > 0 && (
                        <>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                                <div className="bg-gray-900/40 rounded p-2">
                                    <div className="text-gray-500">RX</div>
                                    <div className="font-mono text-emerald-300">{history.at(-1).rx} kbps</div>
                                    <ResponsiveContainer width="100%" height={32}>
                                        <LineChart data={history}><Line type="monotone" dataKey="rx" stroke="#34d399" strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="bg-gray-900/40 rounded p-2">
                                    <div className="text-gray-500">TX</div>
                                    <div className="font-mono text-blue-300">{history.at(-1).tx} kbps</div>
                                    <ResponsiveContainer width="100%" height={32}>
                                        <LineChart data={history}><Line type="monotone" dataKey="tx" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="bg-gray-900/40 rounded p-2">
                                    <div className="text-gray-500">TCP est.</div>
                                    <div className="font-mono text-violet-300">{history.at(-1).tcp}</div>
                                    <ResponsiveContainer width="100%" height={32}>
                                        <LineChart data={history}><Line type="monotone" dataKey="tcp" stroke="#a78bfa" strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="bg-gray-900/40 rounded p-2">
                                    <div className="text-gray-500">Load</div>
                                    <div className="font-mono text-amber-300">{history.at(-1).load.toFixed(2)}</div>
                                    <ResponsiveContainer width="100%" height={32}>
                                        <LineChart data={history}><Line type="monotone" dataKey="load" stroke="#fbbf24" strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                            <p className="text-[10px] text-gray-500">
                                dnstm processes: {history.at(-1).dnstm} ·
                                mem: {history.at(-1).mem}/{history.at(-1).memTotal} MB ·
                                samples: {history.length}/30 (2 s)
                            </p>
                        </>
                    )}
                </div>
            )}

            {/* Phase 4 — Add-on protocols (only when SSH-connected) */}
            {connected && (
                <details className="rounded-lg bg-black/30 border border-fuchsia-900/40">
                    <summary className="cursor-pointer px-3 py-2 text-fuchsia-300 font-bold text-xs uppercase tracking-wider">
                        🧩 {t('dnsTunnel.addonsTitle', 'Add-on protocols (NaiveProxy / StunTLS / WARP)')}
                    </summary>
                    <div className="p-3 pt-0 space-y-3">

                        {/* NaiveProxy */}
                        <div className="space-y-1">
                            <p className="text-fuchsia-300 text-xs font-bold">🛡 NaiveProxy (Caddy + forwardproxy, TLS:443, HTTP/2 + QUIC)</p>
                            <p className="text-gray-500 text-[11px]">Best DPI evasion — looks like a regular HTTPS site. Domain must point to this server with port 443 free.</p>
                            <div className="grid grid-cols-3 gap-2">
                                <input className={ic} placeholder="domain.com" value={naiveDomain} onChange={e => setNaiveDomain(e.target.value)} />
                                <input className={ic} placeholder="username" value={naiveUser} onChange={e => setNaiveUser(e.target.value)} />
                                <input className={ic} type="password" placeholder="password (8+ chars)" value={naivePass} onChange={e => setNaivePass(e.target.value)} />
                            </div>
                            <button
                                onClick={async () => {
                                    setBusyAction('naive');
                                    try {
                                        const r = await tunnelInstallNaive(naiveDomain.trim(), naiveUser.trim(), naivePass);
                                        setNaiveResult(r);
                                        if (r?.success) toast.success('Naive installed'); else toast.error(r?.message || 'Naive install failed');
                                    } catch (e) { toast.error(String(e?.message || e)); }
                                    finally { setBusyAction(null); }
                                }}
                                disabled={busyAction === 'naive'}
                                className="w-full py-1.5 rounded bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-300 text-xs font-bold hover:bg-fuchsia-500/30 disabled:opacity-50"
                            >{busyAction === 'naive' ? 'Installing… (~5 min)' : '⚙ Install Naive'}</button>
                            {naiveResult?.client_url && (
                                <div className="p-2 rounded bg-black/40 border border-fuchsia-900/40">
                                    <p className="text-[10px] text-gray-500">Client URL (paste into NekoBox/Hiddify):</p>
                                    <p className="font-mono text-[11px] text-fuchsia-300 break-all">{naiveResult.client_url}</p>
                                    <button onClick={() => { navigator.clipboard.writeText(naiveResult.client_url); toast.success('Copied'); }} className="text-[10px] text-fuchsia-400 hover:text-white">📋 Copy</button>
                                </div>
                            )}
                        </div>

                        {/* StunTLS */}
                        <div className="space-y-1 border-t border-gray-800 pt-3">
                            <p className="text-fuchsia-300 text-xs font-bold">🔐 StunTLS (SSH-over-TLS:443, self-signed)</p>
                            <p className="text-gray-500 text-[11px]">Wraps SSH:22 in TLS on :443. Defeats DPI that blocks plain SSH but allows HTTPS. Self-signed cert (clients use verify=0).</p>
                            <button
                                onClick={async () => {
                                    setBusyAction('stun');
                                    try {
                                        const r = await tunnelInstallStunTls(443, 22);
                                        setStunResult(r);
                                        if (r?.success) toast.success('StunTLS installed'); else toast.error(r?.message || 'StunTLS install failed');
                                    } catch (e) { toast.error(String(e?.message || e)); }
                                    finally { setBusyAction(null); }
                                }}
                                disabled={busyAction === 'stun'}
                                className="w-full py-1.5 rounded bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-300 text-xs font-bold hover:bg-fuchsia-500/30 disabled:opacity-50"
                            >{busyAction === 'stun' ? 'Installing…' : '⚙ Install StunTLS'}</button>
                            {stunResult?.client_snippet && (
                                <div className="p-2 rounded bg-black/40 border border-fuchsia-900/40">
                                    <p className="text-[10px] text-gray-500">stunnel client config:</p>
                                    <pre className="font-mono text-[10px] text-fuchsia-300 whitespace-pre-wrap">{stunResult.client_snippet}</pre>
                                    <button onClick={() => { navigator.clipboard.writeText(stunResult.client_snippet); toast.success('Copied'); }} className="text-[10px] text-fuchsia-400 hover:text-white">📋 Copy</button>
                                </div>
                            )}
                        </div>

                        {/* WARP */}
                        <div className="space-y-1 border-t border-gray-800 pt-3">
                            <p className="text-fuchsia-300 text-xs font-bold">☁ Cloudflare WARP outbound</p>
                            <p className="text-gray-500 text-[11px]">Routes the VPS's outbound traffic through WARP — masks the server's real IP and helps when the VPS provider itself is filtered upstream.</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={async () => {
                                        setBusyAction('warp-on');
                                        try {
                                            const r = await tunnelToggleWarp(true);
                                            if (r?.success) { setWarpEnabled(true); toast.success('WARP enabled'); }
                                            else toast.error(r?.message || 'WARP failed');
                                        } finally { setBusyAction(null); }
                                    }}
                                    disabled={busyAction === 'warp-on' || warpEnabled}
                                    className="flex-1 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30 disabled:opacity-50"
                                >{busyAction === 'warp-on' ? '…' : '▶ Enable WARP'}</button>
                                <button
                                    onClick={async () => {
                                        setBusyAction('warp-off');
                                        try {
                                            const r = await tunnelToggleWarp(false);
                                            if (r?.success) { setWarpEnabled(false); toast.success('WARP disabled'); }
                                            else toast.error(r?.message || 'WARP off failed');
                                        } finally { setBusyAction(null); }
                                    }}
                                    disabled={busyAction === 'warp-off'}
                                    className="flex-1 py-1.5 rounded bg-gray-700/40 border border-gray-700 text-gray-300 text-xs font-bold hover:bg-gray-700/60 disabled:opacity-50"
                                >{busyAction === 'warp-off' ? '…' : '⏸ Disable WARP'}</button>
                            </div>
                        </div>
                    </div>
                </details>
            )}
        </div>
    );
}
