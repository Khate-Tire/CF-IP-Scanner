import React, { useState, useEffect } from 'react';
import { Sparkles, Activity, Server, ArrowRight, RefreshCw, Copy, Network } from 'lucide-react';
import { getSmartRecommendations } from '../api';
import { toast } from 'react-hot-toast';

export default function SmartRecommendationPanel() {
    const [ips, setIps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadRecommendations();
    }, []);

    const loadRecommendations = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getSmartRecommendations();
            if (data.results && data.results.length > 0) {
                setIps(data.results);
            } else {
                setError("No smart IP data available right now.");
            }
        } catch (e) {
            setError("Failed to reach recommendation engine");
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (ip) => {
        navigator.clipboard.writeText(ip);
        toast.success(`Copied IP: ${ip}`);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-neon-blue" />
                <span className="ml-3 text-neon-blue font-mono">ANTIGRAVITY AI Engine analyzing optimal routes...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-8 text-red-500 font-mono text-sm border border-red-500/20 bg-red-500/5 rounded">
                {error}
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in relative">
            <div className="text-center max-w-2xl mx-auto space-y-3">
                <div className="inline-flex items-center justify-center p-3 rounded-full bg-neon-purple/10 border border-neon-purple/30 mb-2">
                    <Sparkles className="w-8 h-8 text-neon-purple animate-pulse" />
                </div>
                <h2 className="text-2xl font-bold bg-gradient-to-r from-neon-blue to-neon-purple bg-clip-text text-transparent">
                    AI Smart Recommendations
                </h2>
                <p className="text-gray-400 text-sm">
                    These IPs are algorithmically curated from thousands of global scans. The engine analyzes
                    reliability uptime, lowest ping, and highest download speed specifically for your current ISP and region.
                </p>
                <div className="flex justify-center mt-4">
                    <button
                        onClick={loadRecommendations}
                        className="flex items-center gap-2 text-xs text-neon-blue hover:text-white transition-colors py-1 px-3 border border-neon-blue/30 rounded-full hover:bg-neon-blue/20"
                    >
                        <RefreshCw className="w-3 h-3" /> Refresh AI Pool
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
                {ips.map((ipObj, i) => (
                    <div key={i} className="bg-[#0A0A0A] border border-neon-blue/20 rounded-xl p-5 hover:border-neon-purple/50 hover:shadow-[0_0_15px_rgba(202,138,4,0.1)] transition-all group relative overflow-hidden">

                        {/* Decorative background glow based on score tier */}
                        <div className={`absolute -top-10 -right-10 w-24 h-24 rounded-full blur-2xl opacity-10 group-hover:opacity-30 transition-opacity ${ipObj.score > 80 ? 'bg-green-500' : ipObj.score > 50 ? 'bg-yellow-500' : 'bg-neon-blue'
                            }`}></div>

                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <div>
                                <h3 className="text-lg font-bold text-gray-200 tracking-wider flex items-center gap-2">
                                    <Network className="w-4 h-4 text-neon-blue" />
                                    {ipObj.scanned_ip}
                                </h3>
                                <div className="text-xs text-gray-500 mt-1 uppercase tracking-wider">
                                    Tier: {ipObj.tier}
                                </div>
                            </div>
                            <div className="text-right flex flex-col items-end">
                                <span className={`text-2xl font-black ${ipObj.score > 80 ? 'text-green-400' : ipObj.score > 50 ? 'text-yellow-400' : 'text-neon-blue'
                                    }`}>
                                    {Math.round(ipObj.score)}
                                </span>
                                <span className="text-[9px] text-gray-500 uppercase tracking-widest mt-0.5">AI Score</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-4 relative z-10">
                            <div className="bg-black/50 rounded flex flex-col items-center justify-center p-2 border border-white/5">
                                <Activity className="w-3 h-3 text-gray-400 mb-1" />
                                <span className="text-sm font-mono text-gray-300">{Math.round(ipObj.avg_ping)}</span>
                                <span className="text-[10px] text-gray-600">ms ping</span>
                            </div>
                            <div className="bg-black/50 rounded flex flex-col items-center justify-center p-2 border border-white/5">
                                <ArrowRight className="w-3 h-3 text-neon-blue mb-1" />
                                <span className="text-sm font-mono text-neon-blue">{Math.round(ipObj.avg_download || 0)}</span>
                                <span className="text-[10px] text-gray-600">mbps dl</span>
                            </div>
                            <div className="bg-black/50 rounded flex flex-col items-center justify-center p-2 border border-white/5">
                                <Server className="w-3 h-3 text-neon-purple mb-1" />
                                <span className="text-sm font-mono text-neon-purple">{ipObj.total_tests > 0 ? Math.round((ipObj.success_count / ipObj.total_tests) * 100) : 0}%</span>
                                <span className="text-[10px] text-gray-600">uptime</span>
                            </div>
                        </div>

                        <button
                            onClick={() => copyToClipboard(ipObj.scanned_ip)}
                            className="w-full bg-white/5 hover:bg-neon-blue/10 text-gray-300 hover:text-neon-blue rounded py-2 text-sm font-bold transition-colors flex items-center justify-center gap-2 border border-transparent hover:border-neon-blue/30 relative z-10"
                        >
                            <Copy className="w-4 h-4" /> Copy IP
                        </button>
                    </div>
                ))}
            </div>

            {ips.length === 0 && !loading && (
                <div className="text-center py-12 text-gray-500 border border-gray-800 rounded-xl bg-black/20">
                    No AI recommendations found yet. Connect more users to your database to build intelligence.
                </div>
            )}
        </div>
    );
}
