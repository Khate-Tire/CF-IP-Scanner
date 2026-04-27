/* Copyright (c) 2026 Khate Tire */
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import { toast } from 'react-hot-toast';
import { getMyIP, getBestCommunityBypasses } from '../api';

export default function AdvancedScanners({ onStartAdvanced, isLoading, initialDnsConfig, onPresetConsumed }) {
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

    // DNS Tunnel testing state
    const [dnsTestMode, setDnsTestMode] = useState('dnstt'); // 'dnstt' | 'split'
    const [nameserver, setNameserver] = useState('8.8.8.8\n1.1.1.1\n8.8.4.4');
    const [dnsDomain, setDnsDomain] = useState('');
    const [utlsFingerprint, setUtlsFingerprint] = useState('chrome');
    const [fragmentSize, setFragmentSize] = useState('100-200');
    const [fragmentInterval, setFragmentInterval] = useState('10-20');
    const [fragmentPackets, setFragmentPackets] = useState('tlshello');

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
                    toast.success('✨ ' + t('advanced.autoConfigFrags', { isp: ipData.isp }));
                }
            }
        };
        init();
    }, []);

    useEffect(() => {
        if (!initialDnsConfig) return;
        if (initialDnsConfig.mode) setMode(initialDnsConfig.mode);
        if (initialDnsConfig.nameservers) setNameserver(initialDnsConfig.nameservers);
        if (initialDnsConfig.dnsDomain) setDnsDomain(initialDnsConfig.dnsDomain);
        if (initialDnsConfig.vlessConfig) setConfig(initialDnsConfig.vlessConfig);
        if (initialDnsConfig.targetIp) setTargetIp(initialDnsConfig.targetIp);
        if (initialDnsConfig.dnsTestMode) setDnsTestMode(initialDnsConfig.dnsTestMode);
        onPresetConsumed?.();
    }, [initialDnsConfig]);

    const loadTopSnis = async () => {
        if (!detectedIsp) return toast.error(t('advanced.waitIsp'));
        toast.loading(t('advanced.loadingSnis'), { id: 'sniload' });
        const res = await getBestCommunityBypasses(detectedIsp, 'sni', 10);
        if (res && res.results && res.results.length > 0) {
            const newSnis = res.results.map(r => r.sni).join(', ');
            setSnis(newSnis);
            toast.success(t('advanced.loadedSnis', { count: res.results.length }), { id: 'sniload' });
        } else {
            toast.error(t('advanced.noSnisFound'), { id: 'sniload' });
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!config || !targetIp) return toast.error(t('advanced.configRequired'));

        if (mode === 'dns_tunnel' && dnsTestMode === 'dnstt') {
            if (!dnsDomain) return toast.error('DNS Domain is required for DNS Override mode.');
            const nsList = nameserver.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
            if (nsList.length === 0) return toast.error('At least one nameserver is required.');
        }

        const payload = {
            vless_config: config,
            target_ip: targetIp,
            mode,
            rare_mode: rareMode,
            fragment_lengths: mode === 'fragment' ? lengths.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [],
            fragment_intervals: mode === 'fragment' ? intervals.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [],
            test_snis: mode === 'sni' ? snis.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [],
            concurrency: 5,
            max_ping: 3000,
            // DNS Tunnel specific
            ...(mode === 'dns_tunnel' && {
                test_mode: dnsTestMode,
                nameservers: dnsTestMode === 'dnstt' ? nameserver.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : undefined,
                dns_domain: dnsTestMode === 'dnstt' ? dnsDomain : undefined,
                utls_fingerprint: utlsFingerprint || undefined,
                fragment_size: dnsTestMode === 'split' ? fragmentSize : undefined,
                fragment_interval: dnsTestMode === 'split' ? fragmentInterval : undefined,
                fragment_packets: dnsTestMode === 'split' ? fragmentPackets : undefined,
            })
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
                    <button type="button" onClick={() => setMode('dns_tunnel')} className={`px-4 py-1 rounded text-xs transition-all ${mode === 'dns_tunnel' ? 'bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)] font-bold' : 'bg-black text-gray-400 border border-white/10'}`}>DNS Tunnel</button>
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
                            {detectedIsp ? '✨ ' + t('advanced.autoConfigFor', { isp: detectedIsp }) : t('advanced.fragDesc')}
                        </p>
                        <div className="flex items-center gap-2">
                            <input type="checkbox" id="rareMode" checked={rareMode} onChange={e => setRareMode(e.target.checked)} className="accent-neon-purple" />
                            <label htmlFor="rareMode" className="text-xs text-neon-purple font-semibold cursor-pointer" title={t('advanced.rareDesc')}>{t('advanced.generateRare')}</label>
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
                            {t('advanced.loadTopSnis')}
                        </button>
                    </div>
                    <textarea className="input-field h-24 font-mono text-sm" value={snis} onChange={e => setSnis(e.target.value)} placeholder="domain1.com, domain2.com" />
                    <p className="text-xs text-neon-blue mt-2">
                        {detectedIsp ? '✨ ' + t('advanced.connectedDpi', { isp: detectedIsp }) : t('advanced.sniDesc')}
                    </p>
                </div>
            )}

            {mode === 'dns_tunnel' && (
                <div className="p-4 border border-emerald-500/30 bg-emerald-500/5 rounded-lg mb-6 space-y-4">
                    {/* Sub-mode toggle */}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setDnsTestMode('dnstt')}
                            className={`flex-1 py-1.5 rounded text-xs font-semibold transition-all ${
                                dnsTestMode === 'dnstt'
                                    ? 'bg-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                                    : 'bg-black text-gray-400 border border-white/10 hover:text-gray-200'
                            }`}
                        >
                            DNS Override (dnstt)
                        </button>
                        <button
                            type="button"
                            onClick={() => setDnsTestMode('split')}
                            className={`flex-1 py-1.5 rounded text-xs font-semibold transition-all ${
                                dnsTestMode === 'split'
                                    ? 'bg-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                                    : 'bg-black text-gray-400 border border-white/10 hover:text-gray-200'
                            }`}
                        >
                            TLS Split
                        </button>
                    </div>

                    {dnsTestMode === 'dnstt' && (
                        <div className="space-y-3">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Nameservers — one per line or comma-separated</label>
                                <textarea
                                    className="input-field py-2 font-mono text-sm h-20 resize-none"
                                    value={nameserver}
                                    onChange={e => setNameserver(e.target.value)}
                                    placeholder={"8.8.8.8\n1.1.1.1\n8.8.4.4"}
                                />
                                <p className="text-[10px] text-emerald-400/70 mt-1">Each nameserver = 1 test item — creates a grid scan like Fragment mode</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-gray-400 text-xs mb-1">DNS Domain (tunneled via DNS)</label>
                                    <input
                                        className="input-field py-2 font-mono text-sm"
                                        value={dnsDomain}
                                        onChange={e => setDnsDomain(e.target.value)}
                                        placeholder="tunnel.yourdomain.com"
                                        required={mode === 'dns_tunnel' && dnsTestMode === 'dnstt'}
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-400 text-xs mb-1">uTLS Fingerprint</label>
                                    <select
                                        className="input-field py-2 text-sm"
                                        value={utlsFingerprint}
                                        onChange={e => setUtlsFingerprint(e.target.value)}
                                    >
                                        {['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random'].map(fp => (
                                            <option key={fp} value={fp}>{fp}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {dnsTestMode === 'split' && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Fragment Size</label>
                                <input
                                    className="input-field py-2 font-mono text-sm"
                                    value={fragmentSize}
                                    onChange={e => setFragmentSize(e.target.value)}
                                    placeholder="100-200"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Fragment Interval (ms)</label>
                                <input
                                    className="input-field py-2 font-mono text-sm"
                                    value={fragmentInterval}
                                    onChange={e => setFragmentInterval(e.target.value)}
                                    placeholder="10-20"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Packets</label>
                                <select
                                    className="input-field py-2 text-sm"
                                    value={fragmentPackets}
                                    onChange={e => setFragmentPackets(e.target.value)}
                                >
                                    <option value="tlshello">tlshello</option>
                                    <option value="1-3">1-3</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">uTLS Fingerprint</label>
                                <select
                                    className="input-field py-2 text-sm"
                                    value={utlsFingerprint}
                                    onChange={e => setUtlsFingerprint(e.target.value)}
                                >
                                    {['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random'].map(fp => (
                                        <option key={fp} value={fp}>{fp}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    <p className="text-xs text-emerald-400">
                        {dnsTestMode === 'dnstt'
                            ? 'Tests your config routed through a DNS nameserver tunnel. Requires a deployed DNS tunnel server.'
                            : 'Tests your config with TLS packet splitting to bypass deep packet inspection.'}
                    </p>
                </div>
            )}

            <button type="submit" disabled={isLoading} className="btn-primary w-full mt-2 shadow-[0_0_15px_rgba(0,243,255,0.4)]">
                {isLoading ? t('advanced.scanningBypass') : t('advanced.startBypass')}
            </button>
        </form>
    );
}
