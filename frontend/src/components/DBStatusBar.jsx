import React, { useState, useEffect } from 'react';
import { API_URL } from '../api';

const DBStatusBar = () => {
    const [dbStatus, setDbStatus] = useState(null);
    const [isTesting, setIsTesting] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);

    const fetchStatus = async () => {
        setIsTesting(true);
        try {
            const res = await fetch(`${API_URL}/db-test-all`);
            if (res.ok) {
                setDbStatus(await res.json());
            }
        } catch (e) {
            console.error("Failed to fetch DB status", e);
        } finally {
            setIsTesting(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    if (!dbStatus && !isTesting) return null;

    const layers = [
        { key: 'layer1_direct', label: 'Layer 1: Direct MySQL', desc: 'Fastest, but blockable by ISP' },
        { key: 'layer2_worker', label: 'Layer 2: Worker Proxy', desc: 'Cloudflare edge network' },
        { key: 'layer3_fronted', label: 'Layer 3: Clean IP Front', desc: 'Domain fronting bypass' },
        { key: 'layer4_tunnel', label: 'Layer 4: VLESS Tunnel', desc: 'Fallback routing network' },
        { key: 'layer5_local', label: 'Layer 5: Local SQLite', desc: 'Offline mode safety net' },
    ];

    const onlineLayers = dbStatus ? layers.filter(l => dbStatus[l.key]?.status === 'online').length : 0;

    return (
        <div className="fixed bottom-4 left-4 z-[100]">
            {/* Expanded Details Panel */}
            {isExpanded && (
                <div className="absolute bottom-full left-0 mb-3 w-72 bg-[#0f0f0f]/95 backdrop-blur-md border border-gray-800 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in slide-in-from-bottom-5">
                    <div className="bg-gray-900/60 p-3 border-b border-gray-800 flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">Unblockable DB Link</span>
                        <button onClick={(e) => { e.stopPropagation(); fetchStatus(); }} disabled={isTesting} className="text-gray-500 hover:text-neon-blue disabled:opacity-50 transition-colors">
                            <svg className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </button>
                    </div>
                    <div className="p-3 space-y-3">
                        {layers.map(layer => {
                            const res = dbStatus?.[layer.key] || { status: 'testing' };
                            let icon = '⏳';
                            let color = 'text-gray-600';
                            let glow = '';

                            if (res.status === 'online') {
                                icon = '✅';
                                color = 'text-neon-green';
                                glow = 'drop-shadow-[0_0_5px_rgba(57,255,20,0.5)]';
                            }
                            if (res.status === 'offline') { icon = '❌'; color = 'text-red-500'; }
                            if (res.status === 'skipped') { icon = '⏭️'; color = 'text-gray-500'; }
                            if (res.status === 'standby') {
                                icon = '⏸️';
                                color = 'text-yellow-500';
                                layer.label = layer.label.replace('Tunnel', 'Tunnel (Ready)');
                            }

                            return (
                                <div key={layer.key} className="flex items-center justify-between text-xs group">
                                    <div className="flex items-center gap-3">
                                        <span className="w-5 text-center text-sm">{icon}</span>
                                        <div className="flex flex-col">
                                            <span className={`font-mono font-bold ${color} ${glow}`}>{layer.label}</span>
                                            <span className="text-[10px] text-gray-500 group-hover:text-gray-400 transition-colors">{res.reason || layer.desc}</span>
                                        </div>
                                    </div>
                                    <span className="text-gray-500 text-[10px] font-mono">{res.time > 0 ? `${res.time}ms` : ''}</span>
                                </div>
                            );
                        })}
                    </div>
                    {dbStatus?.active_mode && (
                        <div className="p-2.5 bg-gradient-to-r from-neon-purple/5 to-neon-blue/5 border-t border-gray-800 text-center">
                            <span className="text-[10px] text-transparent bg-clip-text bg-gradient-to-r from-neon-purple to-neon-blue font-mono uppercase tracking-widest font-bold">
                                Active Mode: {dbStatus.active_mode.replace('_', ' ')}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Short Summary Bar */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={`flex items-center gap-3 px-4 py-2.5 bg-[#0a0a0a]/90 backdrop-blur-sm border rounded-full shadow-lg transition-all duration-300 ${isExpanded ? 'border-neon-purple shadow-[0_0_15px_rgba(188,19,254,0.3)]' : 'border-gray-800 hover:border-gray-600 hover:bg-[#111]'}`}
            >
                <div className="relative flex h-3 w-3">
                    {isTesting ? (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                    ) : onlineLayers > 0 ? (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-40"></span>
                    ) : (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${isTesting ? 'bg-yellow-500' : onlineLayers > 0 ? 'bg-neon-green drop-shadow-[0_0_8px_rgba(57,255,20,0.8)]' : 'bg-red-500'}`}></span>
                </div>

                <div className="text-[11px] font-mono font-medium text-gray-300 tracking-wide uppercase">
                    {isTesting ? 'Testing DB Connection...' : `DB Link: ${onlineLayers}/5 Online`}
                </div>

                <svg className={`w-3.5 h-3.5 text-gray-500 transform transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" /></svg>
            </button>
        </div>
    );
};

export default DBStatusBar;
