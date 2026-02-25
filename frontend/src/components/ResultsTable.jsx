/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { exportSubscription, getExportLink } from '../api';
import { useTranslation } from '../i18n/LanguageContext';
import { toast } from 'react-hot-toast';

export default function ResultsTable({ results, vlessConfig }) {
    const { t } = useTranslation();
    const [qrData, setQrData] = useState(null);
    const [exportFormat, setExportFormat] = useState('base64');
    const [isExporting, setIsExporting] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'ping', direction: 'asc' });

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedResults = [...results].sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];

        if (['ping', 'jitter', 'download', 'upload'].includes(sortConfig.key)) {
            valA = parseFloat(valA) || (sortConfig.direction === 'asc' ? 9999 : -1);
            valB = parseFloat(valB) || (sortConfig.direction === 'asc' ? 9999 : -1);
        } else {
            valA = valA ? String(valA).toLowerCase() : '';
            valB = valB ? String(valB).toLowerCase() : '';
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        toast.success("Copied to clipboard!");
    };

    const handleExport = async () => {
        const ips = results.map(r => r.ip).filter(Boolean);
        if (!ips.length || !vlessConfig) {
            toast.error("No results or valid config to export.");
            return;
        }
        setIsExporting(true);
        try {
            const res = await exportSubscription(exportFormat, vlessConfig, ips);
            if (res.content) {
                const blob = new Blob([res.content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `antigravity-nodes.${exportFormat === 'clash' ? 'yaml' : exportFormat === 'singbox' ? 'json' : 'txt'}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                toast.error("Export error: " + res.error);
            }
        } catch (e) {
            toast.error("Error: " + e.message);
        }
        setIsExporting(false);
    };

    const handleDeepLink = async (appScheme) => {
        const ips = results.map(r => r.ip).filter(Boolean);
        if (!ips.length || !vlessConfig) {
            toast.error("No results or valid config to link.");
            return;
        }
        setIsExporting(true);
        try {
            const res = await getExportLink(vlessConfig, ips);

            if (res && res.link_id) {
                const subUrl = `http://127.0.0.1:8000/sub/${res.link_id}`;
                let intentUrl = "";
                if (appScheme === 'hidify') {
                    intentUrl = `hidify://import/${subUrl}`;
                } else if (appScheme === 'v2rayng') {
                    intentUrl = `v2rayng://install-sub?url=${encodeURIComponent(subUrl)}`;
                } else if (appScheme === 'v2box') {
                    intentUrl = `v2box://install-sub?url=${encodeURIComponent(subUrl)}`;
                }
                // Trigger deep link locally
                window.location.href = intentUrl;
            } else {
                toast.error("Error creating link: " + (res?.error || "Unknown error"));
            }
        } catch (e) {
            toast.error("Error: " + e.message);
        } finally {
            setIsExporting(false);
        }
    };

    const copyAll = () => {
        const allLinks = results.map(r => r.link).filter(Boolean).join('\n');
        if (allLinks) copyToClipboard(allLinks);
        else toast.error("No valid links to copy.");
    };

    const copyAllIps = () => {
        const allIps = results.map(r => r.ip).filter(Boolean).join('\n');
        if (allIps) copyToClipboard(allIps);
        else toast.error("No valid IPs to copy.");
    };

    return (
        <div className="glass-panel p-6 mt-6 neon-border">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-neon-green drop-shadow-[0_0_5px_rgba(57,255,20,0.8)]">
                    {t('results.title')}
                </h2>
                <div className="flex items-center space-x-3">
                    {/* Deep Links Container */}
                    <div className="flex items-center bg-[#0d0d12] border border-neon-purple/40 rounded-xl p-1 shadow-[0_0_15px_rgba(188,19,254,0.15)] relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-r from-neon-purple/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                        <span className="text-[10px] font-black pl-3 pr-2 text-neon-purple tracking-widest z-10 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                            SEND
                        </span>
                        <div className="flex gap-1 z-10">
                            <button onClick={() => handleDeepLink('v2rayng')} disabled={isExporting} className="bg-black/40 hover:bg-neon-purple hover:text-white text-gray-400 text-xs px-2.5 py-1.5 rounded-lg transition-all font-bold border border-transparent hover:border-neon-purple/50">
                                v2rayNG
                            </button>
                            <button onClick={() => handleDeepLink('hidify')} disabled={isExporting} className="bg-black/40 hover:bg-neon-blue hover:text-white text-gray-400 text-xs px-2.5 py-1.5 rounded-lg transition-all font-bold border border-transparent hover:border-neon-blue/50">
                                Hidify
                            </button>
                            <button onClick={() => handleDeepLink('v2box')} disabled={isExporting} className="bg-black/40 hover:bg-neon-green hover:text-black text-gray-400 text-xs px-2.5 py-1.5 rounded-lg transition-all font-bold border border-transparent hover:border-neon-green/50">
                                V2Box
                            </button>
                        </div>
                    </div>

                    {/* Standard Export */}
                    <div className="flex items-center bg-[#0a0a0a] border border-neon-green/40 rounded-xl p-1 shadow-[0_0_15px_rgba(57,255,20,0.1)] relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-neon-green/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-xl"></div>
                        <div className="relative z-10 h-full flex items-center">
                            <select
                                value={exportFormat}
                                onChange={(e) => setExportFormat(e.target.value)}
                                className="bg-transparent text-xs text-gray-300 outline-none border-none pl-2 pr-6 py-1.5 font-medium appearance-none cursor-pointer h-full"
                            >
                                <option value="base64" className="bg-[#0a0a0a]">v2rayN (Base64)</option>
                                <option value="clash" className="bg-[#0a0a0a]">Clash Meta</option>
                                <option value="singbox" className="bg-[#0a0a0a]">Sing-box</option>
                            </select>
                            <div className="absolute inset-y-0 right-1 flex items-center pointer-events-none text-gray-500">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>
                        <button
                            onClick={handleExport}
                            disabled={isExporting}
                            className="text-xs px-4 py-1.5 bg-neon-green text-black font-black hover:bg-[#00ff88] transition-colors rounded-lg shadow-[0_0_10px_rgba(57,255,20,0.3)] hover:shadow-[0_0_15px_rgba(57,255,20,0.6)] z-10 ml-1 flex items-center gap-1.5"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            {isExporting ? '...' : t('results.save')}
                        </button>
                    </div>

                    <div className="flex items-center bg-[#0a0a0a] border border-gray-700/60 rounded-xl p-1 shadow-inner">
                        <button onClick={copyAllIps} className="text-xs px-3 py-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all font-medium flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                            {t('results.copyIps')}
                        </button>
                        <div className="w-[1px] h-4 bg-gray-700/70 mx-1"></div>
                        <button onClick={copyAll} className="text-xs px-3 py-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all font-medium flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                            {t('results.copyConfigs')}
                        </button>
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-gray-700 text-gray-400 text-sm uppercase tracking-wider">
                            <th className="p-3 cursor-pointer hover:bg-white/5 transition-colors select-none" onClick={() => requestSort('ip')}>{t('results.ipAddress')} {sortConfig.key === 'ip' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                            <th className="p-3 cursor-pointer hover:bg-white/5 transition-colors select-none" onClick={() => requestSort('ping')}>{t('results.pingMs')} {sortConfig.key === 'ping' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                            <th className="p-3 cursor-pointer hover:bg-white/5 transition-colors select-none" onClick={() => requestSort('jitter')}>{t('results.jitterMs')} {sortConfig.key === 'jitter' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                            <th className="p-3 cursor-pointer hover:bg-white/5 transition-colors select-none" onClick={() => requestSort('download')}>{t('results.downloadMbps')} {sortConfig.key === 'download' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                            <th className="p-3 cursor-pointer hover:bg-white/5 transition-colors select-none" onClick={() => requestSort('upload')}>{t('results.uploadMbps')} {sortConfig.key === 'upload' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                            <th className="p-3 cursor-pointer hover:bg-white/5 transition-colors select-none" onClick={() => requestSort('location')}>{t('results.locationIsp')} {sortConfig.key === 'location' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                            <th className="p-3 cursor-pointer hover:bg-white/5 transition-colors select-none" onClick={() => requestSort('status')}>{t('results.status')} {sortConfig.key === 'status' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                            <th className="p-3 text-right">{t('results.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm">
                        {results.length === 0 ? (
                            <tr>
                                <td colSpan="8" className="p-8 text-center text-gray-500 italic">
                                    {t('results.noGoodIps')}
                                </td>
                            </tr>
                        ) : (
                            sortedResults.map((res, i) => (
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
                        <h3 className="text-xl font-bold mb-4 text-white">{t('results.qrTitle')}</h3>
                        <div className="bg-white p-4 rounded-lg">
                            <QRCodeCanvas value={qrData} size={256} />
                        </div>
                        <p className="mt-4 text-xs text-center text-gray-400 break-all">{qrData}</p>
                        <button
                            onClick={() => setQrData(null)}
                            className="mt-6 btn-secondary w-full"
                        >
                            {t('results.close')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
