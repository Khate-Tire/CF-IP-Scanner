import React from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function FragmentChart({ results }) {
    const data = results.filter(r => r.tested_config && r.tested_config.startsWith("Frag:")).map(r => {
        const parts = r.tested_config.replace("Frag: ", "").split(" / ");
        if (parts.length === 2) {
            return {
                x: parts[0],
                y: parts[1],
                status: r.status,
                ping: r.ping
            };
        }
        return null;
    }).filter(Boolean);

    if (data.length === 0) return null;

    const xCategories = Array.from(new Set(data.map(d => d.x)));
    const yCategories = Array.from(new Set(data.map(d => d.y)));

    const plotData = data.map(d => ({
        xIndex: xCategories.indexOf(d.x),
        yIndex: yCategories.indexOf(d.y),
        xValue: d.x,
        yValue: d.y,
        status: d.status,
        ping: d.ping
    }));

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-black/90 border border-gray-700 p-2 text-xs text-white neon-border">
                    <p>Length: {data.xValue}</p>
                    <p>Interval: {data.yValue}</p>
                    <p>Status: <span className={data.status === 'ok' ? 'text-neon-green font-bold' : 'text-red-500'}>{data.status}</span></p>
                    {data.status === 'ok' && <p>Ping: {data.ping}ms</p>}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="glass-panel p-6 mt-6 neon-border relative group">
            <div className="absolute inset-0 bg-neon-purple/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-2xl"></div>
            <h3 className="text-xl font-bold mb-4 text-neon-purple drop-shadow-[0_0_5px_rgba(188,19,254,0.8)] tracking-wider uppercase text-center">
                DPI Firewall Penetration Map
            </h3>

            <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis
                            type="number"
                            dataKey="xIndex"
                            name="Length"
                            tickFormatter={idx => xCategories[idx] || ''}
                            stroke="#888"
                            domain={[-0.5, xCategories.length - 0.5]}
                            ticks={xCategories.map((_, i) => i)}
                        />
                        <YAxis
                            type="number"
                            dataKey="yIndex"
                            name="Interval"
                            tickFormatter={idx => yCategories[idx] || ''}
                            stroke="#888"
                            domain={[-0.5, yCategories.length - 0.5]}
                            ticks={yCategories.map((_, i) => i)}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter name="Fragment Configs" data={plotData} shape="circle">
                            {plotData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.status === 'ok' ? '#39ff14' : '#ff0000'} />
                            ))}
                        </Scatter>
                    </ScatterChart>
                </ResponsiveContainer>
            </div>

            <div className="flex justify-center mt-4 space-x-6 text-xs text-gray-500 uppercase font-bold tracking-widest">
                <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-[#39ff14] shadow-[0_0_10px_#39ff14]"></span>
                    <span>Bypass Successful</span>
                </div>
                <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-[#ff0000] shadow-[0_0_10px_#ff0000]"></span>
                    <span>Interception Detected</span>
                </div>
            </div>
        </div>
    );
}
