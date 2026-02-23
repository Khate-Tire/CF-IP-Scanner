/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useEffect } from 'react';
import { getHealth, proxyDatabase } from '../api';

function HealthWidget() {
    const [health, setHealth] = useState({ internet: 'checking', database: 'checking', internet_error: '', database_error: '', via_proxy: false });
    const [isProxying, setIsProxying] = useState(false);
    const [showProxyModal, setShowProxyModal] = useState(false);
    const [proxyConfig, setProxyConfig] = useState('');

    useEffect(() => {
        const checkHealth = async () => {
            const h = await getHealth();
            setHealth(h);
        };

        checkHealth();
        const interval = setInterval(checkHealth, 30000);
        return () => clearInterval(interval);
    }, []);

    const renderStatus = (status, errorMsg) => {
        if (status === 'checking') return <span className="text-yellow-500 animate-pulse text-xs">● Checking</span>;
        if (status === 'online') return <span className="text-neon-green text-xs drop-shadow-[0_0_5px_rgba(57,255,20,0.8)]">● Online</span>;
        return (
            <span
                className="text-red-500 text-xs drop-shadow-[0_0_5px_rgba(255,0,0,0.8)] cursor-help border-b border-dashed border-red-500/50"
                title={errorMsg || "Connection failed"}
            >
                ● Offline
            </span>
        );
    };

    const handleProxySubmit = async () => {
        if (!proxyConfig || !proxyConfig.startsWith('vless://')) return alert("Please enter a valid VLESS config.");
        setIsProxying(true);
        const res = await proxyDatabase(proxyConfig);
        setIsProxying(false);

        if (res.status === 'ok') {
            setShowProxyModal(false);
            setHealth({ ...health, database: 'online', via_proxy: true });
            alert(res.message);
        } else {
            alert(res.message);
        }
    };

    return (
        <div className="absolute top-4 right-4 flex items-center gap-4 bg-black/60 border border-white/20 px-4 py-2 rounded-full glass-panel z-50">
            <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Cloudflare</span>
                {renderStatus(health.internet, health.internet_error)}
            </div>

            <div className="w-px h-6 bg-white/20"></div>

            <div className="flex items-center gap-3">
                <div className="flex flex-col items-center">
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Global DB</span>
                    <div className="flex items-center gap-1">
                        {renderStatus(health.database, health.database_error)}
                        {health.via_proxy && health.database === 'online' && (
                            <span
                                className="text-amber-400 text-[10px] cursor-help"
                                title="Connected through VLESS proxy tunnel (ISP bypass active)"
                            >
                                🔀
                            </span>
                        )}
                    </div>
                </div>

                {health.database === 'offline' && (
                    <button
                        onClick={() => setShowProxyModal(true)}
                        className="bg-red-500/20 hover:bg-neon-blue/20 text-red-400 hover:text-neon-blue border border-red-500/50 hover:border-neon-blue font-bold text-xs px-2 py-1 rounded transition-colors"
                        title="If your ISP blocked the global database, click here to tunnel it through your VPN."
                    >
                        Tunnel DB
                    </button>
                )}
            </div>

            {showProxyModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] backdrop-blur-sm">
                    <div className="glass-panel p-6 max-w-lg w-full neon-border">
                        <h3 className="text-lg font-bold text-neon-blue mb-2">Initialize Database Tunnel</h3>
                        <p className="text-sm text-gray-300 mb-4 whitespace-normal">
                            Your ISP is blocking the direct connection to the Community Data Repository.
                            <br /><br />
                            Paste any working <strong>VLESS</strong> URL below. The scanner will instantly spin up a local proxy router and tunnel the secure MySQL connection through that VLESS server to bypass the network block!
                        </p>

                        <textarea
                            className="input-field h-24 font-mono text-sm w-full mb-4"
                            placeholder="vless://..."
                            value={proxyConfig}
                            onChange={(e) => setProxyConfig(e.target.value)}
                        />

                        <div className="flex flex-col sm:flex-row justify-end gap-3 mt-4">
                            <button
                                onClick={() => setShowProxyModal(false)}
                                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleProxySubmit}
                                disabled={isProxying}
                                className={`btn-primary px-6 py-2 text-sm ${isProxying ? 'opacity-50' : ''}`}
                            >
                                {isProxying ? "Connecting..." : "Tunnel Network"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default HealthWidget;
