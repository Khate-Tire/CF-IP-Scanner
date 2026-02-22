import React, { useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';

export default function AdvancedScanners({ onStartAdvanced, isLoading }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState('fragment'); // fragment | sni
    const [targetIp, setTargetIp] = useState('');
    const [config, setConfig] = useState('');

    // Fragment testing state
    const [lengths, setLengths] = useState('10-20, 100-200, 30-50, 5-15, 30-100');
    const [intervals, setIntervals] = useState('10-20, 50-100, 10-30');

    // SNI testing state
    const [snis, setSnis] = useState('yahoo.com, zendesk.com, spotify.com');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!config || !targetIp) return alert('Config and Base Target IP are required!');

        const payload = {
            vless_config: config,
            target_ip: targetIp,
            mode,
            fragment_lengths: mode === 'fragment' ? lengths.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [],
            fragment_intervals: mode === 'fragment' ? intervals.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [],
            test_snis: mode === 'sni' ? snis.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [],
            concurrency: 5,
            max_ping: 3000
        };

        onStartAdvanced(payload);
    };

    return (
        <form onSubmit={handleSubmit} className="glass-panel p-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-neon-blue to-white">
                    {t('advanced.title')}
                </h2>
                <div className="flex gap-2">
                    <button type="button" onClick={() => setMode('fragment')} className={`px-4 py-1 rounded text-xs transition-all ${mode === 'fragment' ? 'bg-neon-purple text-white shadow-[0_0_10px_rgba(188,19,254,0.5)]' : 'bg-black text-gray-400 border border-white/10'}`}>{t('advanced.fragment')}</button>
                    <button type="button" onClick={() => setMode('sni')} className={`px-4 py-1 rounded text-xs transition-all ${mode === 'sni' ? 'bg-neon-blue text-black shadow-[0_0_10px_rgba(0,243,255,0.5)] font-bold' : 'bg-black text-gray-400 border border-white/10'}`}>{t('advanced.sni')}</button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="col-span-2 md:col-span-1">
                    <label className="block text-gray-400 text-sm mb-2">{t('advanced.vlessConfig')}</label>
                    <textarea className="input-field h-16 font-mono text-sm" value={config} onChange={e => setConfig(e.target.value)} required placeholder="vless://..." />
                </div>
                <div className="col-span-2 md:col-span-1">
                    <label className="block text-gray-400 text-sm mb-2">{t('advanced.targetIp')}</label>
                    <input className="input-field py-3 font-mono" value={targetIp} onChange={e => setTargetIp(e.target.value)} required placeholder="e.g. 104.21.3.4" />
                </div>
            </div>

            {mode === 'fragment' && (
                <div className="grid grid-cols-2 gap-4 p-4 border border-neon-purple/30 bg-neon-purple/5 rounded-lg mb-6">
                    <div className="col-span-2"><p className="text-xs text-gray-300">{t('advanced.fragDesc')}</p></div>
                    <div>
                        <label className="block text-gray-400 text-xs mb-1">{t('advanced.lengths')}</label>
                        <input className="input-field py-2 font-mono text-sm" value={lengths} onChange={e => setLengths(e.target.value)} placeholder="10-20, 100-200" />
                    </div>
                    <div>
                        <label className="block text-gray-400 text-xs mb-1">{t('advanced.intervals')}</label>
                        <input className="input-field py-2 font-mono text-sm" value={intervals} onChange={e => setIntervals(e.target.value)} placeholder="10-20, 50-100" />
                    </div>
                </div>
            )}

            {mode === 'sni' && (
                <div className="p-4 border border-neon-blue/30 bg-neon-blue/5 rounded-lg mb-6">
                    <label className="block text-gray-400 text-xs mb-2">{t('advanced.sniLabel')}</label>
                    <textarea className="input-field h-24 font-mono text-sm" value={snis} onChange={e => setSnis(e.target.value)} placeholder="domain1.com, domain2.com" />
                    <p className="text-xs text-gray-400 mt-2">{t('advanced.sniDesc')}</p>
                </div>
            )}

            <button type="submit" disabled={isLoading} className="btn-primary w-full mt-2 shadow-[0_0_15px_rgba(0,243,255,0.4)]">
                {isLoading ? t('advanced.scanningBypass') : t('advanced.startBypass')}
            </button>
        </form>
    );
}
