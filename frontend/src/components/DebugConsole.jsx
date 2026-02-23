import React, { useState, useEffect, useRef } from 'react';
import { API_URL } from '../api';

export default function DebugConsole() {
    const [open, setOpen] = useState(false);
    const [logs, setLogs] = useState([]);
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const fetchLogs = async () => {
            try {
                const res = await fetch(`${API_URL}/debug-logs`);
                const data = await res.json();
                setLogs(data.logs || []);
            } catch (e) {
                setLogs(prev => [...prev, `[ERROR] Cannot reach backend: ${e.message}`]);
            }
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

    return (
        <div className="fixed bottom-0 left-0 right-0 z-[200]">
            {/* Toggle button */}
            <button
                onClick={() => setOpen(!open)}
                className="absolute bottom-2 left-2 bg-black/80 border border-white/20 text-[10px] text-gray-400 hover:text-neon-blue px-3 py-1 rounded-full transition-all z-[201]"
            >
                {open ? '▼ Close Debug' : '▲ Debug Console'}
            </button>

            {/* Log panel */}
            {open && (
                <div className="bg-[#0a0a0f]/95 backdrop-blur-xl border-t border-neon-blue/30 shadow-[0_-4px_20px_rgba(0,243,255,0.1)]"
                    style={{ height: '240px' }}>
                    <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/10">
                        <span className="text-[10px] font-bold text-neon-blue uppercase tracking-widest">Backend Debug Log</span>
                        <span className="text-[9px] text-gray-500">{logs.length} entries • Auto-refresh 2s</span>
                    </div>
                    <div className="overflow-y-auto font-mono text-[11px] leading-5 p-3" style={{ height: '200px' }}>
                        {logs.length === 0 && (
                            <div className="text-gray-600 italic">Waiting for backend logs...</div>
                        )}
                        {logs.map((line, i) => (
                            <div key={i} className={`whitespace-pre-wrap ${line.includes('✅') ? 'text-green-400' :
                                    line.includes('❌') ? 'text-red-400' :
                                        line.includes('⚠️') ? 'text-amber-400' :
                                            line.includes('═══') ? 'text-neon-blue font-bold' :
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
