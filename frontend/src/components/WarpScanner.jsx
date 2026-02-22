import React, { useState, useEffect } from 'react';
import { scanWarpIPs, getWarpScanStatus, stopWarpScan } from '../api';
import { useTranslation } from '../i18n/LanguageContext';

export default function WarpScanner() {
    const { t } = useTranslation();
    const [concurrency, setConcurrency] = useState(50);
    const [stopAfter, setStopAfter] = useState(20);
    const [maxPing, setMaxPing] = useState(500);
    const [targetPorts, setTargetPorts] = useState([2408, 1701, 500, 4500]);

    // Status
    const [scanId, setScanId] = useState(null);
    const [status, setStatus] = useState('idle');
    const [metrics, setMetrics] = useState({ completed: 0, found: 0 });
    const [logs, setLogs] = useState([]);
    const [results, setResults] = useState([]);

    const togglePort = (p) => {
        setTargetPorts(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const handleStart = async () => {
        if (targetPorts.length === 0) {
            alert("Please select at least one port.");
            return;
        }

        setStatus('starting');
        setLogs([]);
        setResults([]);
        setMetrics({ completed: 0, found: 0 });

        try {
            const res = await scanWarpIPs({
                concurrency,
                stop_after: stopAfter,
                max_ping: maxPing,
                test_ports: targetPorts
            });
            if (res.scan_id) {
                setScanId(res.scan_id);
                setStatus('running');
            } else {
                setStatus('error');
                setLogs([res.error || 'Failed to start scan']);
            }
        } catch (e) {
            setStatus('error');
            setLogs([e.message]);
        }
    };

    const handleStop = async () => {
        if (scanId) {
            await stopWarpScan(scanId);
            setStatus('stopped');
        }
    };

    useEffect(() => {
        let interval;
        if (scanId && status === 'running') {
            interval = setInterval(async () => {
                try {
                    const data = await getWarpScanStatus(scanId);
                    if (data.status) {
                        setMetrics({
                            completed: data.status.completed,
                            found: data.status.found_good
                        });
                        setLogs(data.status.logs || []);
                        if (data.status.status !== 'running') {
                            setStatus(data.status.status);
                        }
                    }
                    if (data.results) {
                        setResults(data.results);
                    }
                } catch (e) { }
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [scanId, status]);

    const copyAllEndpoints = () => {
        const text = results.map(r => r.endpoint).join('\n');
        navigator.clipboard.writeText(text);
        alert('Copied all endpoints to clipboard!');
    };

    // To prevent warning
    const ALL_PORTS = [2408, 1701, 500, 4500];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="glass-panel p-6 neon-border" style={{ boxShadow: '0 0 15px rgba(251, 146, 60, 0.2)', borderColor: 'rgba(251, 146, 60, 0.4)' }}>
                <h2 className="text-2xl font-bold mb-2 text-orange-400 drop-shadow-[0_0_5px_rgba(251,146,60,0.8)]">
                    {t('warp.title')}
                </h2>
                <p className="text-gray-400 text-sm mb-6">{t('warp.desc')}</p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label className="block text-gray-400 text-xs mb-1">{t('warp.threads')}</label>
                        <input type="number" value={concurrency} onChange={e => setConcurrency(parseInt(e.target.value))} className="input-field py-2" />
                    </div>
                    <div>
                        <label className="block text-gray-400 text-xs mb-1">{t('warp.targetEndpoints')}</label>
                        <input type="number" value={stopAfter} onChange={e => setStopAfter(parseInt(e.target.value))} className="input-field py-2" />
                    </div>
                    <div>
                        <label className="block text-gray-400 text-xs mb-1">{t('warp.maxPing')}</label>
                        <input type="number" value={maxPing} onChange={e => setMaxPing(parseInt(e.target.value))} className="input-field py-2" />
                    </div>
                </div>

                <div className="mt-6 mb-6">
                    <label className="block text-gray-400 text-xs mb-2">{t('warp.ports')}</label>
                    <div className="flex flex-wrap gap-2">
                        {ALL_PORTS.map(p => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => togglePort(p)}
                                className={`px-4 py-2 text-sm rounded-full border transition-all ${targetPorts.includes(p)
                                    ? 'bg-orange-500/20 text-orange-400 border-orange-500 shadow-[0_0_8px_rgba(251,146,60,0.4)]'
                                    : 'bg-black/40 text-gray-400 border-white/10 hover:border-white/30'
                                    }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex gap-4">
                    {status === 'running' ? (
                        <button onClick={handleStop} className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded shadow-[0_0_15px_rgba(220,38,38,0.5)] transition-all">
                            {t('warp.stopScanning')}
                        </button>
                    ) : (
                        <button onClick={handleStart} className="flex-1 py-3 px-4 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded shadow-[0_0_15px_rgba(234,88,12,0.6)] transition-all">
                            {t('warp.startHunt')}
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 glass-panel p-6 flex flex-col h-[500px]">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-white">{t('warp.cleanEndpoints')} ({results.length}/{stopAfter})</h3>
                        {results.length > 0 && <button onClick={copyAllEndpoints} className="text-orange-400 text-sm hover:underline">{t('warp.copyAll')}</button>}
                    </div>

                    <div className="flex-1 overflow-auto p-4 bg-black/50 rounded border border-white/5 space-y-2">
                        {results.map((res, i) => (
                            <div key={i} className="flex justify-between items-center p-3 bg-white/5 rounded hover:bg-white/10 transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_#22c55e]"></div>
                                    <span className="font-mono text-gray-200 font-bold">{res.endpoint}</span>
                                </div>
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="text-gray-400">{res.datacenter || 'UNK'}</span>
                                    <span className="text-green-400">{res.ping} ms</span>
                                </div>
                            </div>
                        ))}
                        {results.length === 0 && <div className="text-center text-gray-500 mt-10">{t('warp.noEndpoints')}</div>}
                    </div>
                </div>

                <div className="glass-panel p-6 flex flex-col h-[500px]">
                    <h3 className="text-xl font-bold text-white mb-4">{t('warp.logs')}</h3>
                    <div className="flex-1 overflow-auto p-4 bg-black/50 rounded border border-white/5 font-mono text-xs text-gray-400 space-y-1">
                        {logs.slice().reverse().map((log, i) => (
                            <div key={i} className={log.includes('GOOD') || log.includes('clean') ? 'text-green-400' : ''}>{log}</div>
                        ))}
                        {logs.length === 0 && <div className="text-center text-gray-600 mt-10">{t('warp.waiting')}</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
