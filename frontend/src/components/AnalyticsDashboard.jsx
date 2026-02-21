import React, { useEffect, useState } from 'react';
import { getAnalytics } from '../api';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function AnalyticsDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getAnalytics().then(res => {
            setData(res);
            setLoading(false);
        });
    }, []);

    if (loading) {
        return <div className="text-neon-blue text-center animate-pulse">Loading Global Intelligence...</div>;
    }

    if (!data) return <div className="text-red-500 text-center">Failed to load analytics.</div>;

    const { top_datacenters, top_ports, network_types, total_scans, total_good, timeline_data } = data;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="glass-panel p-6 neon-border text-center">
                    <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-2">Total IP Scans</h3>
                    <div className="text-4xl font-black text-white">{total_scans?.toLocaleString() || 0}</div>
                </div>
                <div className="glass-panel p-6 neon-border text-center">
                    <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-2">Verified Good IPs</h3>
                    <div className="text-4xl font-black text-neon-blue">{total_good?.toLocaleString() || 0}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-panel p-6 col-span-1 md:col-span-2 text-center md:text-left">
                    <h3 className="text-lg font-bold text-neon-purple mb-4">Discovery Performance Over Time (7 Days)</h3>
                    {timeline_data && timeline_data.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={timeline_data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                                    <XAxis dataKey="date" stroke="#666" fontSize={12} tickMargin={10} />
                                    <YAxis stroke="#666" fontSize={12} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#BC13FE', color: '#fff' }}
                                        itemStyle={{ color: '#fff' }}
                                    />
                                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                                    <Line type="monotone" dataKey="total_scans" name="Total Scans Executed" stroke="#555" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                                    <Line type="monotone" dataKey="successful_scans" name="Successful Bypasses" stroke="#BC13FE" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6, stroke: '#fff' }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm py-10 text-center">No scanning history available yet.</div>
                    )}
                </div>

                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-neon-blue mb-4">Datacenter Latency (Average Ping)</h3>
                    {top_datacenters && top_datacenters.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={top_datacenters} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#222" horizontal={true} vertical={false} />
                                    <XAxis type="number" stroke="#666" fontSize={12} />
                                    <YAxis dataKey="datacenter" type="category" stroke="#00f3ff" fontSize={12} fontWeight="bold" />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(0,243,255,0.1)' }}
                                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: '#00f3ff', color: '#fff' }}
                                    />
                                    <Bar dataKey="avg_ping" name="Avg Latency (ms)" fill="#00f3ff" radius={[0, 4, 4, 0]} barSize={15} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm py-10 text-center">No datacenter data available yet.</div>
                    )}
                </div>

                <div className="space-y-6">
                    <div className="glass-panel p-6">
                        <h3 className="text-lg font-bold text-neon-blue mb-4">Fastest Ports</h3>
                        <div className="space-y-3">
                            {top_ports?.map((pt, i) => (
                                <div key={i} className="flex justify-between items-center bg-black/40 p-2 rounded">
                                    <span className="text-gray-300 font-mono">Port {pt.port}</span>
                                    <span className="text-neon-blue">{pt.count} successes</span>
                                </div>
                            ))}
                            {(!top_ports || top_ports.length === 0) && (
                                <div className="text-gray-500 text-sm">No port data available yet.</div>
                            )}
                        </div>
                    </div>

                    <div className="glass-panel p-6">
                        <h3 className="text-lg font-bold text-white mb-4">Network Protocols</h3>
                        <div className="space-y-3">
                            {network_types?.map((nt, i) => (
                                <div key={i} className="flex justify-between items-center bg-black/40 p-2 rounded">
                                    <span className="text-gray-300 font-mono uppercase">{nt.network_type}</span>
                                    <span className="text-white">{nt.count} routes</span>
                                </div>
                            ))}
                            {(!network_types || network_types.length === 0) && (
                                <div className="text-gray-500 text-sm">No network protocol data available yet.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
