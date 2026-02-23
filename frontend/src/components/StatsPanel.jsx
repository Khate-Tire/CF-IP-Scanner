/* Copyright (c) 2026 Taher AkbariSaeed */
import React from 'react';

export default function StatsPanel({ stats }) {
    if (!stats) return null;

    const items = [
        { label: "Scanned", value: stats.scanned, color: "text-white" },
        { label: "High Ping", value: stats.high_ping, color: "text-red-400" },
        { label: "High Jitter", value: stats.high_jitter, color: "text-orange-400" },
        { label: "Low Download", value: stats.low_download, color: "text-yellow-400" },
        { label: "Low Upload", value: stats.low_upload, color: "text-yellow-400" },
        { label: "Timeout", value: stats.timeout, color: "text-gray-500" },
        { label: "Unreachable", value: stats.unreachable, color: "text-red-600" },
    ];

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            {items.map((item, idx) => (
                <div key={idx} className="glass-panel p-3 text-center neon-border border-gray-800">
                    <div className={`text-2xl font-bold font-mono ${item.color}`}>
                        {item.value}
                    </div>
                    <div className="text-xs text-gray-400 uppercase tracking-wider mt-1">
                        {item.label}
                    </div>
                </div>
            ))}
        </div>
    );
}
