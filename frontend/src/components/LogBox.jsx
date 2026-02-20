import React, { useRef, useEffect } from 'react';

export default function LogBox({ logs }) {
    const bottomRef = useRef(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="glass-panel p-4 neon-border mt-6">
            <h3 className="text-lg font-bold mb-2 text-neon-blue">Live Activity</h3>
            <div className="h-48 overflow-y-auto font-mono text-xs text-gray-400 bg-black/50 p-2 rounded border border-white/5">
                {logs.length === 0 && <span className="opacity-50">Waiting for scan start...</span>}
                {logs.map((log, i) => (
                    <div key={i} className="mb-1 border-b border-white/5 pb-0.5">
                        {log}
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
