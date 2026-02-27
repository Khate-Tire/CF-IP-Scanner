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
        return <div className="text-neon-blue text-center animate-pulse">{t('analytics.loading')}</div>;
    }

    if (!data || data.error) return <div className="text-red-500 text-center">{data?.error || t('analytics.failed')}</div>;

    const { top_datacenters, top_ports, network_types, top_asns, top_isps, fail_reasons, total_scans, total_good, timeline_data } = data;

    const outcomeData = [
        { name: 'Success', value: total_good || 0 },
        ...(fail_reasons || []).map(f => ({ name: f.fail_reason, value: f.count }))
    ];
    const COLORS = ['#00f3ff', '#ff0055', '#ff9900', '#BC13FE', '#888888', '#555555'];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 pb-12">
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
                                <PieChart>
                                    <Pie data={outcomeData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value">
                                        {outcomeData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#444', color: '#fff' }} />
                                    <Legend />
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
                                    <YAxis dataKey="datacenter" type="category" stroke="#00f3ff" fontSize={12} fontWeight="bold" />
                                    <Tooltip cursor={{ fill: 'rgba(0,243,255,0.1)' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#00f3ff', color: '#fff' }} />
                                    <Bar dataKey="avg_ping" name="Avg Latency (ms)" fill="#00f3ff" radius={[0, 4, 4, 0]} barSize={15} />
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
                                <ComposedChart data={top_isps} margin={{ top: 10, right: 10, bottom: 25, left: 0 }}>
                                    <defs>
                                        <linearGradient id="colorIsp" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#BC13FE" stopOpacity={0.4} />
                                            <stop offset="95%" stopColor="#BC13FE" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                                    <XAxis dataKey="isp" stroke="#888" fontSize={10} angle={-25} textAnchor="end" />
                                    <YAxis stroke="#666" fontSize={12} />
                                    <Tooltip cursor={{ fill: 'rgba(188,19,254,0.1)' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#BC13FE', color: '#fff' }} />
                                    <Area type="monotone" dataKey="count" fill="url(#colorIsp)" stroke="#BC13FE" />
                                    <Bar dataKey="count" name="Successful Scans" barSize={20} fill="#BC13FE" radius={[4, 4, 0, 0]} />
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
                                <RadarChart cx="50%" cy="50%" outerRadius="75%" data={top_asns}>
                                    <PolarGrid stroke="#333" />
                                    <PolarAngleAxis dataKey="asn" tick={{ fill: '#888', fontSize: 11 }} />
                                    <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: '#555', fontSize: 10 }} />
                                    <Radar name="Active Verified IPs" dataKey="count" stroke="#00f3ff" fill="#00f3ff" fillOpacity={0.4} />
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#00f3ff', color: '#fff' }} />
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
                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-neon-blue mb-4">{t('analytics.fastestPorts')}</h3>
                    <div className="space-y-3">
                        {top_ports?.map((pt, i) => (
                            <div key={i} className="flex justify-between items-center bg-black/40 p-2 rounded">
                                <span className="text-gray-300 font-mono">Port {pt.port}</span>
                                <span className="text-neon-blue">{pt.count} {t('analytics.successes')}</span>
                            </div>
                        ))}
                        {(!top_ports || top_ports.length === 0) && (
                            <div className="text-gray-500 text-sm">{t('analytics.noData')}</div>
                        )}
                    </div>
                </div>

                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-white mb-4">{t('analytics.networkProto')}</h3>
                    <div className="space-y-3">
                        {network_types?.map((nt, i) => (
                            <div key={i} className="flex justify-between items-center bg-black/40 p-2 rounded">
                                <span className="text-gray-300 font-mono uppercase">{nt.network_type}</span>
                                <span className="text-white">{nt.count} {t('analytics.routes')}</span>
                            </div>
                        ))}
                        {(!network_types || network_types.length === 0) && (
                            <div className="text-gray-500 text-sm">{t('analytics.noData')}</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
