/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import { toast } from 'react-hot-toast';
import { getMyIP, getBestCommunityBypasses } from '../api';

export default function AdvancedScanners({ onStartAdvanced, isLoading }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState('fragment'); // fragment | sni
    const [targetIp, setTargetIp] = useState('');
    const [config, setConfig] = useState('');

    const [detectedIsp, setDetectedIsp] = useState('');
    const [rareMode, setRareMode] = useState(true);

    // Fragment testing state
    const [lengths, setLengths] = useState('10-20, 100-200, 30-50, 5-15, 30-100');
    const [intervals, setIntervals] = useState('10-20, 50-100, 10-30');

    // SNI testing state
    const [snis, setSnis] = useState('yahoo.com, zendesk.com, spotify.com');

    useEffect(() => {
        const init = async () => {
            const ipData = await getMyIP();
            if (ipData && !ipData.error && ipData.isp) {
                setDetectedIsp(ipData.isp);

                // Fetch best fragments for this ISP
                const frags = await getBestCommunityBypasses(ipData.isp, 'fragment', 3);
                if (frags && frags.results && frags.results.length > 0) {
                    const l = frags.results.map(r => r.length).join(', ');
                    const i = frags.results.map(r => r.interval).join(', ');
                    setLengths(l);
                    setIntervals(i);
                    toast.success(`✨ Auto-configured proven fragments for ${ipData.isp}`);
                }
            }
        };
        init();
    }, []);

    const loadTopSnis = async () => {
        if (!detectedIsp) return toast.error("Wait for ISP detection first");
        toast.loading("Loading community SNIs...", { id: 'sniload' });
        const res = await getBestCommunityBypasses(detectedIsp, 'sni', 10);
        if (res && res.results && res.results.length > 0) {
            const newSnis = res.results.map(r => r.sni).join(', ');
            setSnis(newSnis);
            toast.success(`Loaded ${res.results.length} unblocked SNIs!`, { id: 'sniload' });
        } else {
            toast.error("No community SNIs found for your ISP yet.", { id: 'sniload' });
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!config || !targetIp) return toast.error('Config and Base Target IP are required!');

        const payload = {
            vless_config: config,
            target_ip: targetIp,
            mode,
            rare_mode: rareMode,
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
                    <div className="col-span-2 flex justify-between items-center">
                        <p className="text-xs text-gray-300">
                            {detectedIsp ? `✨ Auto-configured for ${detectedIsp}` : t('advanced.fragDesc')}
                        </p>
                        <div className="flex items-center gap-2">
                            <input type="checkbox" id="rareMode" checked={rareMode} onChange={e => setRareMode(e.target.checked)} className="accent-neon-purple" />
                            <label htmlFor="rareMode" className="text-xs text-neon-purple font-semibold cursor-pointer" title="Generates highly randomized asymmetric intervals to actively evade GFW heuristic blocking.">Generate Rare Fragments</label>
                        </div>
                    </div>
                    <div>
                        <label className="block text-gray-400 text-xs mb-1">{t('advanced.lengths')}</label>
                        <input className="input-field py-2 font-mono text-sm" value={lengths} onChange={e => setLengths(e.target.value)} disabled={rareMode} placeholder="10-20, 100-200" />
                    </div>
                    <div>
                        <label className="block text-gray-400 text-xs mb-1">{t('advanced.intervals')}</label>
                        <input className="input-field py-2 font-mono text-sm" value={intervals} onChange={e => setIntervals(e.target.value)} disabled={rareMode} placeholder="10-20, 50-100" />
                    </div>
                </div>
            )}

            {mode === 'sni' && (
                <div className="p-4 border border-neon-blue/30 bg-neon-blue/5 rounded-lg mb-6">
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-gray-400 text-xs">{t('advanced.sniLabel')}</label>
                        <button type="button" onClick={loadTopSnis} className="text-xs bg-neon-blue/10 text-neon-blue px-2 py-1 rounded hover:bg-neon-blue/20 transition-colors">
                            Load Top Community SNIs
                        </button>
                    </div>
                    <textarea className="input-field h-24 font-mono text-sm" value={snis} onChange={e => setSnis(e.target.value)} placeholder="domain1.com, domain2.com" />
                    <p className="text-xs text-neon-blue mt-2">
                        {detectedIsp ? `✨ Connected to ${detectedIsp} DPI Evasion Database` : t('advanced.sniDesc')}
                    </p>
                </div>
            )}

            <button type="submit" disabled={isLoading} className="btn-primary w-full mt-2 shadow-[0_0_15px_rgba(0,243,255,0.4)]">
                {isLoading ? t('advanced.scanningBypass') : t('advanced.startBypass')}
            </button>
        </form>
    );
}
