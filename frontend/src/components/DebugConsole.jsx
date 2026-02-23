import React, { useState, useEffect, useRef } from 'react';
import { API_URL } from '../api';

export default function DebugConsole() {
    const [open, setOpen] = useState(false);
    const [logs, setLogs] = useState([]);
    const [source, setSource] = useState('checking');
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (!open) return;

        const fetchLogs = async () => {
            // Try 1: Backend API (if backend is running)
            try {
                const res = await fetch(`${API_URL}/debug-logs`, { signal: AbortSignal.timeout(2000) });
                const data = await res.json();
                if (data.logs && data.logs.length > 0) {
                    setLogs(data.logs);
                    setSource('backend-api');
                    return;
                }
            } catch (e) {
                // Backend not reachable
            }

            // Try 2: Electron log file (via IPC)
            try {
                if (window.require) {
                    const { ipcRenderer } = window.require('electron');
                    const fs = window.require('fs');
                    const logPath = await ipcRenderer.invoke('get-log-path');
                    if (logPath && fs.existsSync(logPath)) {
                        const content = fs.readFileSync(logPath, 'utf8');
                        const lines = content.split('\n').filter(l => l.trim());
                        setLogs(lines);
                        setSource('electron-log');
                        return;
                    }
                }
            } catch (e) {
                // Not in Electron
            }

            // Neither worked
            setSource('disconnected');
            setLogs(prev => {
                const msg = `[${new Date().toLocaleTimeString()}] ⚠️ Backend not running. Check if backend.exe crashed on startup.`;
                if (prev.length === 0 || prev[prev.length - 1] !== msg) {
                    return [...prev.slice(-50), msg];
                }
                return prev;
            });
        };

        fetchLogs();
        const interval = setInterval(fetchLogs, 2000);
        return () => clearInterval(interval);
    }, [open]);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const sourceLabel = {
        'checking': '⏳ Connecting...',
        'backend-api': '🟢 Backend API',
        'electron-log': '📄 Electron Log File',
        'disconnected': '🔴 Backend Offline'
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 z-[200]">
            <button
                onClick={() => setOpen(!open)}
                className="absolute bottom-2 left-2 bg-black/80 border border-white/20 text-[10px] text-gray-400 hover:text-neon-blue px-3 py-1 rounded-full transition-all z-[201]"
            >
                {open ? '▼ Close Debug' : '▲ Debug Console'}
            </button>

            {open && (
                <div className="bg-[#0a0a0f]/95 backdrop-blur-xl border-t border-neon-blue/30 shadow-[0_-4px_20px_rgba(0,243,255,0.1)]"
                    style={{ height: '260px' }}>
                    <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/10">
                        <span className="text-[10px] font-bold text-neon-blue uppercase tracking-widest">Debug Log</span>
                        <div className="flex items-center gap-4">
                            <span className="text-[9px] text-gray-500">{sourceLabel[source]}</span>
                            <span className="text-[9px] text-gray-500">{logs.length} entries</span>
                        </div>
                    </div>
                    <div className="overflow-y-auto font-mono text-[11px] leading-5 p-3" style={{ height: '220px' }}>
                        {logs.length === 0 && (
                            <div className="text-gray-600 italic">Waiting for logs...</div>
                        )}
                        {logs.map((line, i) => (
                            <div key={i} className={`whitespace-pre-wrap break-all ${line.includes('✅') || line.includes('ready') ? 'text-green-400' :
                                    line.includes('❌') || line.includes('ERR') || line.includes('ERROR') || line.includes('error') ? 'text-red-400' :
                                        line.includes('⚠️') || line.includes('WARNING') || line.includes('Waiting') ? 'text-amber-400' :
                                            line.includes('═══') ? 'text-neon-blue font-bold' :
                                                line.includes('Backend:') ? 'text-cyan-300' :
                                                    'text-gray-400'
                                }`}>
                                {line}
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>
            )}
        </div>
    );
}
