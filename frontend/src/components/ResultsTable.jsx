import React, { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

export default function ResultsTable({ results }) {
    const [qrData, setQrData] = useState(null);

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        // Could add a toast notification here
        alert("Copied to clipboard!");
    };

    const copyAll = () => {
        const allLinks = results.map(r => r.link).filter(Boolean).join('\n');
        if (allLinks) copyToClipboard(allLinks);
        else alert("No valid links to copy.");
    };

    const copyAllIps = () => {
        const allIps = results.map(r => r.ip).filter(Boolean).join('\n');
        if (allIps) copyToClipboard(allIps);
        else alert("No valid IPs to copy.");
    };

    return (
        <div className="glass-panel p-6 mt-6 neon-border">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-neon-green drop-shadow-[0_0_5px_rgba(57,255,20,0.8)]">
                    Scan Results
                </h2>
                <div className="space-x-4">
                    <button onClick={copyAllIps} className="btn-secondary text-xs px-3 py-1">
                        Copy All IPs
                    </button>
                    <button onClick={copyAll} className="btn-secondary text-xs px-3 py-1">
                        Copy All Configs
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-gray-700 text-gray-400 text-sm uppercase tracking-wider">
                            <th className="p-3">IP Address</th>
                            <th className="p-3">Ping (ms)</th>
                            <th className="p-3">Jitter (ms)</th>
                            <th className="p-3">Download (Mbps)</th>
                            <th className="p-3">Upload (Mbps)</th>
                            <th className="p-3">Location / ISP</th>
                            <th className="p-3">Status</th>
                            <th className="p-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm">
                        {results.length === 0 ? (
                            <tr>
                                <td colSpan="8" className="p-8 text-center text-gray-500 italic">
                                    No good IPs found yet...
                                </td>
                            </tr>
                        ) : (
                            results.map((res, i) => (
                                <tr key={i} className="border-b border-gray-800 hover:bg-white/5 transition-colors">
                                    <td className="p-3 font-mono font-bold text-white">{res.ip}</td>
                                    <td className={`p-3 font-mono font-bold ${res.ping < 100 ? 'text-neon-green' : 'text-yellow-400'}`}>
                                        {res.ping}
                                    </td>
                                    <td className="p-3 font-mono text-gray-300">{res.jitter}</td>
                                    <td className="p-3 font-mono text-neon-blue">{res.download || '-'}</td>
                                    <td className="p-3 font-mono text-neon-purple">{res.upload || '-'}</td>
                                    <td className="p-3 text-gray-400 text-xs max-w-[200px] truncate" title={res.location}>
                                        {res.location}
                                    </td>
                                    <td className="p-3">
                                        <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${res.status === 'ok' ? 'bg-neon-green/20 text-neon-green' : 'bg-red-500/20 text-red-500'
                                            }`}>
                                            {res.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-right space-x-2">
                                        {res.link && (
                                            <>
                                                <button
                                                    onClick={() => copyToClipboard(res.link)}
                                                    className="text-gray-400 hover:text-white transition-colors"
                                                    title="Copy Config"
                                                >
                                                    📋
                                                </button>
                                                <button
                                                    onClick={() => setQrData(res.link)}
                                                    className="text-gray-400 hover:text-white transition-colors"
                                                    title="Show QR Code"
                                                >
                                                    📷
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* QR Modal */}
            {qrData && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setQrData(null)}>
                    <div className="glass-panel p-6 max-w-sm w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold mb-4 text-white">Config QR Code</h3>
                        <div className="bg-white p-4 rounded-lg">
                            <QRCodeCanvas value={qrData} size={256} />
                        </div>
                        <p className="mt-4 text-xs text-center text-gray-400 break-all">{qrData}</p>
                        <button
                            onClick={() => setQrData(null)}
                            className="mt-6 btn-secondary w-full"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
