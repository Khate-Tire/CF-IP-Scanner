/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useEffect, useState } from 'react';
import { getAnalytics } from '../api';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart, Area } from 'recharts';
import WorldHeatmap from './WorldHeatmap';
import { useTranslation } from '../i18n/LanguageContext';

export default function AnalyticsDashboard() {
    const { t } = useTranslation();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [provider, setProvider] = useState('cloudflare');

    useEffect(() => {
        setLoading(true);
        getAnalytics(provider).then(res => {
            setData(res);
            setLoading(false);
        });
    }, [provider]);

    if (loading) {
        return (
            <div className="space-y-6 animate-in fade-in pb-12">
                <div className="h-10 w-48 bg-gray-800/50 rounded-xl mx-auto animate-pulse"></div>
                <div className="h-64 w-full bg-gray-900/40 rounded-xl animate-pulse border border-gray-800"></div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="h-28 bg-gray-900/40 rounded-xl animate-pulse border border-gray-800"></div>
                    <div className="h-28 bg-gray-900/40 rounded-xl animate-pulse border border-gray-800"></div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="h-80 col-span-1 lg:col-span-2 bg-gray-900/40 rounded-xl animate-pulse border border-gray-800"></div>
                    <div className="h-80 bg-gray-900/40 rounded-xl animate-pulse border border-gray-800"></div>
                    <div className="h-80 bg-gray-900/40 rounded-xl animate-pulse border border-gray-800"></div>
                    <div className="h-80 bg-gray-900/40 rounded-xl animate-pulse border border-gray-800"></div>
                    <div className="h-80 bg-gray-900/40 rounded-xl animate-pulse border border-gray-800"></div>
                </div>
            </div>
        );
    }

    if (!data || data.error) return <div className="text-red-500 text-center">{data?.error || t('analytics.failed')}</div>;

    const { top_datacenters, top_ports, network_types, top_asns, top_isps, fail_reasons, total_scans, total_good, timeline_data } = data;

    const outcomeData = [
        { name: 'Success', value: total_good || 0 },
        ...(fail_reasons || []).map(f => ({ name: f.fail_reason, value: f.count }))
    ];
    // Vibrant cohesive palette for the donut chart
    const COLORS = ['#BC13FE', '#ff0055', '#ff9900', '#00f3ff', '#ff00aa', '#444444', '#777777'];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 pb-12">
            {/* SVG Definitions for Gradients */}
            <svg style={{ height: 0, width: 0, position: 'absolute' }}>
                <defs>
                    <linearGradient id="cyanGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#0055ff" />
                        <stop offset="100%" stopColor="#00f3ff" />
                    </linearGradient>
                    <linearGradient id="purpleGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#BC13FE" />
                        <stop offset="100%" stopColor="#6b00ff" />
                    </linearGradient>
                    <linearGradient id="purpleArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#BC13FE" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#BC13FE" stopOpacity={0} />
                    </linearGradient>
                </defs>
            </svg>

            {/* Provider Toggle */}
            <div className="flex justify-center mb-6">
                <div className="bg-[#1a1a24] p-1 rounded-xl flex shadow-lg">
                    <button
                        onClick={() => setProvider('cloudflare')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${provider === 'cloudflare' ? 'bg-[#BC13FE]/20 text-neon-purple border border-neon-purple shadow-[0_0_10px_rgba(188,19,254,0.3)]' : 'text-gray-400 hover:text-white'}`}
                    >
                        Cloudflare
                    </button>
                    <button
                        onClick={() => setProvider('fastly')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${provider === 'fastly' ? 'bg-[#BC13FE]/20 text-neon-purple border border-neon-purple shadow-[0_0_10px_rgba(188,19,254,0.3)]' : 'text-gray-400 hover:text-white'}`}
                    >
                        Fastly CDN
                    </button>
                </div>
            </div>

            {/* World Heatmap - Hero Section */}
            <WorldHeatmap provider={provider} />

            <div className="grid grid-cols-2 gap-4">
                <div className="glass-panel p-6 neon-border text-center">
                    <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-2">{t('analytics.totalScans')}</h3>
                    <div className="text-4xl font-black text-white">{total_scans?.toLocaleString() || 0}</div>
                </div>
                <div className="glass-panel p-6 neon-border text-center">
                    <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-2">{t('analytics.verifiedGood')}</h3>
                    <div className="text-4xl font-black text-neon-blue">{total_good?.toLocaleString() || 0}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Timeline */}
                <div className="glass-panel p-6 col-span-1 lg:col-span-2 text-center md:text-left">
                    <h3 className="text-lg font-bold text-neon-purple mb-4">{t('analytics.timeline')}</h3>
                    {timeline_data && timeline_data.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={timeline_data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                                    <XAxis dataKey="date" stroke="#666" fontSize={12} tickMargin={10} />
                                    <YAxis stroke="#666" fontSize={12} />
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#BC13FE', color: '#fff' }} itemStyle={{ color: '#fff' }} />
                                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                                    <Line type="monotone" dataKey="total_scans" name="Total Scans Executed" stroke="#555" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                                    <Line type="monotone" dataKey="successful_scans" name="Successful Bypasses" stroke="#BC13FE" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6, stroke: '#fff' }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm py-10 text-center">{t('analytics.noData')}</div>
                    )}
                </div>

                {/* Outcomes Donut */}
                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-white mb-4">Scan Outcomes</h3>
                    {outcomeData && outcomeData.length > 0 ? (
                        <div className="h-64 w-full text-xs">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart margin={{ top: 0, right: 0, bottom: 20, left: 0 }}>
                                    <Pie data={outcomeData} cx="50%" cy="45%" innerRadius={65} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none">
                                        {outcomeData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#444', color: '#fff', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                    <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 10, paddingTop: "15px", paddingBottom: "5px" }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm py-10 text-center">{t('analytics.noData')}</div>
                    )}
                </div>

                {/* DC Latency */}
                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-neon-blue mb-4">{t('analytics.dcLatency')}</h3>
                    {top_datacenters && top_datacenters.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={top_datacenters} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#222" horizontal={true} vertical={false} />
                                    <XAxis type="number" stroke="#666" fontSize={12} />
                                    <YAxis dataKey="datacenter" type="category" stroke="#eee" fontSize={11} fontWeight="bold" />
                                    <Tooltip cursor={{ fill: 'rgba(0,243,255,0.05)' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#00f3ff', color: '#fff', borderRadius: '8px' }} />
                                    <Bar dataKey="avg_ping" name="Avg Latency (ms)" fill="url(#cyanGradient)" radius={[0, 4, 4, 0]} barSize={16} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm py-10 text-center">{t('analytics.noData')}</div>
                    )}
                </div>

                {/* Top ISPs Area */}
                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-neon-purple mb-4">Top User ISPs</h3>
                    {top_isps && top_isps.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={top_isps} margin={{ top: 10, right: 10, bottom: 35, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                                    <XAxis dataKey="isp" stroke="#888" fontSize={10} angle={-35} textAnchor="end" tickMargin={5} height={40} />
                                    <YAxis stroke="#666" fontSize={12} />
                                    <Tooltip cursor={{ fill: 'rgba(188,19,254,0.05)' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#BC13FE', color: '#fff', borderRadius: '8px' }} />
                                    <Area type="monotone" dataKey="count" fill="url(#purpleArea)" stroke="#BC13FE" strokeWidth={2} />
                                    <Bar dataKey="count" name="Successful Scans" barSize={16} fill="url(#purpleGradient)" radius={[4, 4, 0, 0]} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm py-10 text-center">{t('analytics.noData')}</div>
                    )}
                </div>

                {/* Top ASNs Radar */}
                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-neon-blue mb-4">Top Contributor ASNs</h3>
                    {top_asns && top_asns.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={top_asns}>
                                    <PolarGrid stroke="#333" />
                                    <PolarAngleAxis dataKey="asn" tick={{ fill: '#eee', fontSize: 11 }} />
                                    <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: '#777', fontSize: 10 }} axisLine={false} />
                                    <Radar name="Active Verified IPs" dataKey="count" stroke="#00f3ff" strokeWidth={2} fill="url(#cyanGradient)" fillOpacity={0.5} />
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#00f3ff', color: '#fff', borderRadius: '8px' }} />
                                </RadarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm py-10 text-center">{t('analytics.noData')}</div>
                    )}
                </div>
            </div>

            {/* Ports & Protocols row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-panel p-6 relative overflow-hidden group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-[20px] blur opacity-0 group-hover:opacity-100 transition duration-1000"></div>
                    <div className="relative">
                        <h3 className="text-lg font-bold text-neon-blue mb-4 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
                            {t('analytics.fastestPorts')}
                        </h3>
                        <div className="space-y-3">
                            {top_ports?.map((pt, i) => {
                                const maxCount = Math.max(...(top_ports.map(p => p.count) || [1]));
                                return (
                                    <div key={i} className="relative w-full bg-black/40 rounded-lg overflow-hidden flex justify-between items-center px-4 py-3 border border-white/5 shadow-inner">
                                        <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-500/20 to-transparent transition-all duration-1000" style={{ width: `${(pt.count / maxCount) * 100}%` }}></div>
                                        <span className="relative text-gray-200 font-mono text-sm tracking-widest leading-none">PORT {pt.port}</span>
                                        <span className="relative text-neon-blue font-bold text-sm leading-none">{pt.count} {t('analytics.successes')}</span>
                                    </div>
                                );
                            })}
                            {(!top_ports || top_ports.length === 0) && (
                                <div className="text-gray-500 text-sm">{t('analytics.noData')}</div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="glass-panel p-6 relative overflow-hidden group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-[20px] blur opacity-0 group-hover:opacity-100 transition duration-1000"></div>
                    <div className="relative">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <svg className="w-5 h-5 text-neon-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            {t('analytics.networkProto')}
                        </h3>
                        <div className="space-y-3">
                            {network_types?.map((nt, i) => {
                                const maxCount = Math.max(...(network_types.map(n => n.count) || [1]));
                                return (
                                    <div key={i} className="relative w-full bg-black/40 rounded-lg overflow-hidden flex justify-between items-center px-4 py-3 border border-white/5 shadow-inner">
                                        <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-500/20 to-transparent transition-all duration-1000" style={{ width: `${(nt.count / maxCount) * 100}%` }}></div>
                                        <span className="relative text-gray-200 font-mono text-sm tracking-widest uppercase leading-none">{nt.network_type}</span>
                                        <span className="relative text-white font-bold text-sm leading-none">{nt.count} {t('analytics.routes')}</span>
                                    </div>
                                );
                            })}
                            {(!network_types || network_types.length === 0) && (
                                <div className="text-gray-500 text-sm">{t('analytics.noData')}</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
