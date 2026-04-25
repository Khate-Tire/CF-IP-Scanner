/* Copyright (c) 2026 Taher AkbariSaeed */
/**
 * DeployManage — manage an EXISTING dnstm install on a remote VPS.
 * Workflow: SSH-connect (re-uses tunnelConnect from api.js) → status →
 * restart / users / update / uninstall. Persists last-known host in
 * localStorage so reconnects are one click.
 */
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from '../i18n/LanguageContext';
import {
    tunnelConnect, tunnelDisconnect,
    tunnelManageStatus, tunnelManageRestart,
    tunnelManageUsersList, tunnelManageUserAdd, tunnelManageUserRemove,
    tunnelManageUpdate, tunnelManageUninstall,
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

    const doConnect = async () => {
        if (!host || !username) { toast.error('Host and username required'); return; }
        if (authMode === 'password' && !password) { toast.error('Password required'); return; }
        if (authMode === 'key' && !privateKey) { toast.error('Private key required'); return; }
        setConnecting(true);
        try {
            const r = await tunnelConnect({
                host, port: Number(port) || 22, username,
                password: authMode === 'password' ? password : '',
                private_key: authMode === 'key' ? privateKey : '',
            });
            if (r?.success) {
                setConnected(true);
                persist();
                toast.success(`Connected to ${host}`);
                await refreshStatus();
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
        </div>
    );
}
