import React, { useState, useEffect } from 'react';
import { getFreedomStatus, provideFreedomConfig } from '../api';
import { Activity, Radio, Cpu, Network, Server, Play, Square, Loader, Send, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function FreedomWidget({ onStart, onStop }) {
    const [status, setStatus] = useState(null);
    const [userConfig, setUserConfig] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [expandedSection, setExpandedSection] = useState(null);

    useEffect(() => {
        let interval;
        const poll = async () => {
            try {
                const res = await getFreedomStatus();
                setStatus(res);
            } catch (e) {
                // Background might be offline
            }
        };
        poll();
        interval = setInterval(poll, 2000);
        return () => clearInterval(interval);
    }, []);

    if (!status) return null;

    const isRunning = status.status === 'running';
    const needsConfig = status.waiting_for_config;

    const handleSubmitConfig = async () => {
        if (!userConfig.trim()) { toast.error('Please paste a valid VLESS config'); return; }
        setSubmitting(true);
        try {
            const res = await provideFreedomConfig(userConfig.trim());
            if (res.error) { toast.error(res.error); }
            else { toast.success('Config submitted! Mining will resume...'); setUserConfig(''); }
        } catch (e) { toast.error('Failed to submit config'); }
        finally { setSubmitting(false); }
    };

    return (
        <div className={`mt-6 w-full max-w-4xl mx-auto rounded-3xl overflow-hidden transition-all duration-700 border ${isRunning ? 'border-teal-500/50 shadow-[0_0_30px_rgba(20,184,166,0.3)] bg-black/80' : 'border-white/10 bg-black/40'}`}>
            <div className="flex flex-col md:flex-row">
                
                {/* Control Panel */}
                <div className="p-6 md:w-1/3 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-white/10 relative">
                    {isRunning && (
                        <div className="absolute inset-0 bg-teal-500/5 animate-pulse"></div>
                    )}
                    
                    <Activity className={`w-12 h-12 mb-4 ${isRunning ? 'text-teal-400 animate-pulse' : 'text-gray-600'}`} />
                    
                    <h3 className="text-xl font-bold text-white mb-1">Play Freedom</h3>
                    <p className="text-xs text-gray-400 text-center mb-6">Fully autonomous unblockable proxy miner</p>
                    
                    {!isRunning ? (
                        <button 
                            onClick={onStart}
                            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-emerald-500 text-black font-black rounded-full hover:scale-105 transition-transform shadow-[0_0_20px_rgba(20,184,166,0.5)]"
                        >
                            <Play className="w-5 h-5" fill="currentColor" />
                            START AUTOPILOT
                        </button>
                    ) : (
                        <button 
                            onClick={onStop}
                            className="flex items-center gap-2 px-6 py-3 bg-red-500/20 text-red-500 font-bold border border-red-500/50 rounded-full hover:bg-red-500 hover:text-white transition-colors"
                        >
                            <Square className="w-5 h-5" fill="currentColor" />
                            STOP
                        </button>
                    )}
                </div>

                {/* Dashboard Stats */}
                <div className="p-6 md:w-2/3">
                    <div className="mb-4">
                        <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Current Phase</h4>
                        <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                            {isRunning ? <Loader className="w-5 h-5 text-teal-400 animate-spin" /> : <div className="w-2 h-2 rounded-full bg-gray-600" />}
                            <span className={`font-mono text-sm ${isRunning ? 'text-teal-300' : 'text-gray-500'}`}>
                                {status.phase || "Ready"}
                            </span>
                        </div>
                    </div>

                    {needsConfig && (
                        <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                            <p className="text-sm text-yellow-400 font-bold mb-2">⚠️ No working config found. Paste a working VLESS config to continue:</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={userConfig}
                                    onChange={e => setUserConfig(e.target.value)}
                                    placeholder="vless://..."
                                    className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:border-yellow-500/50 focus:outline-none"
                                />
                                <button
                                    onClick={handleSubmitConfig}
                                    disabled={submitting}
                                    className={`flex items-center gap-1 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${submitting ? 'bg-gray-600 text-gray-400 cursor-wait' : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/40'}`}
                                >
                                    <Send className="w-4 h-4" />
                                    {submitting ? 'Sending...' : 'Submit'}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                        {[
                            { key: 'sub', icon: <Radio className="w-5 h-5 text-purple-400 mb-1" />, label: 'Vanilla Sub OK', color: 'purple' },
                            { key: 'sub_cf', icon: <Network className="w-5 h-5 text-blue-400 mb-1" />, label: 'CF Sub OK', color: 'blue' },
                            { key: 'spliced', icon: <Cpu className="w-5 h-5 text-pink-400 mb-1" />, label: 'Spliced Multipliers', color: 'pink' },
                        ].map(({ key, icon, label, color }) => {
                            const configs = status.found_configs?.[key] || [];
                            const isExpanded = expandedSection === key;
                            return (
                                <div key={key}
                                    className={`flex flex-col items-center p-3 rounded-xl border cursor-pointer transition-colors ${configs.length > 0 ? `bg-${color}-500/10 border-${color}-500/20 hover:border-${color}-500/50` : 'bg-white/5 border-white/5'}`}
                                    onClick={() => configs.length > 0 && setExpandedSection(isExpanded ? null : key)}
                                >
                                    {icon}
                                    <span className="text-2xl font-black text-white">{configs.length}</span>
                                    <span className="text-[10px] text-gray-500 uppercase font-bold text-center">{label}</span>
                                    {configs.length > 0 && (
                                        isExpanded ? <ChevronUp className="w-3 h-3 text-gray-400 mt-1" /> : <ChevronDown className="w-3 h-3 text-gray-400 mt-1" />
                                    )}
                                </div>
                            );
                        })}
                        <div className="flex flex-col items-center p-3 bg-white/5 rounded-xl border border-white/5">
                            <Server className="w-5 h-5 text-emerald-400 mb-1" />
                            <span className="text-2xl font-black text-white">{status.found_configs?.mined_clean_ips || 0}</span>
                            <span className="text-[10px] text-gray-500 uppercase font-bold text-center">Clean IPs Mined</span>
                        </div>
                    </div>

                    {expandedSection && (status.found_configs?.[expandedSection]?.length > 0) && (
                        <div className="mt-3 p-3 bg-black/60 border border-white/10 rounded-xl">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-gray-400 uppercase">Found Configs ({status.found_configs[expandedSection].length})</span>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(status.found_configs[expandedSection].join('\n'));
                                        toast.success('All configs copied!');
                                    }}
                                    className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 transition-colors"
                                >
                                    <Copy className="w-3 h-3" /> Copy All
                                </button>
                            </div>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                                {status.found_configs[expandedSection].map((cfg, i) => (
                                    <div key={i} className="flex items-center gap-2 group">
                                        <div className="flex-1 text-xs font-mono text-gray-300 truncate" title={cfg}>{cfg}</div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(cfg); toast.success('Config copied!'); }}
                                            className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white transition-all shrink-0"
                                            title="Copy"
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {status.logs && status.logs.length > 0 && (
                        <div className="mt-4 p-3 bg-black/50 border border-white/5 rounded-xl h-24 overflow-y-auto">
                            {status.logs.map((log, i) => (
                                <div key={i} className="text-xs font-mono text-gray-400 mb-1 opacity-80">
                                    {log}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
