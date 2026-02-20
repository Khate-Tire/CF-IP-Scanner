import React, { useState } from 'react';

export default function ConfigInput({ onStartScan, isLoading }) {
    const [config, setConfig] = useState('');
    const [useManual, setUseManual] = useState(false);
    const [manualIps, setManualIps] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Settings
    const [stopAfter, setStopAfter] = useState(10);
    const [concurrency, setConcurrency] = useState(5);
    const [maxPing, setMaxPing] = useState(800);
    const [maxJitter, setMaxJitter] = useState(200);
    const [minDown, setMinDown] = useState(0);
    const [minUp, setMinUp] = useState(0);
    const [ipVersion, setIpVersion] = useState("all");

    const handleSubmit = (e) => {
        e.preventDefault();
        onStartScan(config, useManual ? manualIps.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : null, {
            stopAfter, concurrency, maxPing, maxJitter, minDown, minUp, ipVersion
        });
    };

    return (
        <div className="glass-panel p-6 max-w-2xl mx-auto mt-10 neon-border">
            <h2 className="text-2xl font-bold mb-4 text-neon-blue drop-shadow-[0_0_5px_rgba(0,243,255,0.8)]">
                VLESS Configuration
            </h2>
            <form onSubmit={handleSubmit}>
                <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">VLESS URL</label>
                    <textarea
                        className="input-field h-24 font-mono text-sm"
                        placeholder="vless://..."
                        value={config}
                        onChange={(e) => setConfig(e.target.value)}
                        required
                    />
                </div>

                <div className="mb-4">
                    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-neon-blue underline mb-2">
                        {showAdvanced ? "Hide Advanced Settings" : "Show Advanced Settings"}
                    </button>

                    {showAdvanced && (
                        <div className="grid grid-cols-2 gap-4 mb-4 p-4 border border-white/10 rounded-lg bg-black/30">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Threads (Concurrency)</label>
                                <input type="number" value={concurrency} onChange={e => setConcurrency(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Stop after (Good IPs)</label>
                                <input type="number" value={stopAfter} onChange={e => setStopAfter(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Max Ping (ms)</label>
                                <input type="number" value={maxPing} onChange={e => setMaxPing(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Max Jitter (ms)</label>
                                <input type="number" value={maxJitter} onChange={e => setMaxJitter(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Min Download (Mbps)</label>
                                <input type="number" value={minDown} onChange={e => setMinDown(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Min Upload (Mbps)</label>
                                <input type="number" value={minUp} onChange={e => setMinUp(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div className="col-span-2 mt-2">
                                <label className="block text-gray-400 text-xs mb-1">IP Version</label>
                                <select
                                    value={ipVersion}
                                    onChange={e => setIpVersion(e.target.value)}
                                    className="input-field py-1"
                                >
                                    <option value="all">Both IPv4 & IPv6</option>
                                    <option value="ipv4">IPv4 Only</option>
                                    <option value="ipv6">IPv6 Only</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mb-4">
                    <label className="flex items-center space-x-2 cursor-pointer text-gray-300 mb-2">
                        <input
                            type="checkbox"
                            checked={useManual}
                            onChange={(e) => setUseManual(e.target.checked)}
                            className="w-4 h-4 accent-neon-blue"
                        />
                        <span>Use Manual IPs</span>
                    </label>

                    {useManual && (
                        <textarea
                            className="input-field h-24 font-mono text-sm animate-in fade-in slide-in-from-top-2"
                            placeholder="1.1.1.1, 8.8.8.8..."
                            value={manualIps}
                            onChange={(e) => setManualIps(e.target.value)}
                        />
                    )}
                </div>

                <button
                    type="submit"
                    disabled={isLoading || !config}
                    className={`btn-primary w-full ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {isLoading ? 'Scanning...' : 'Start Scan'}
                </button>
            </form>
        </div>
    );
}
