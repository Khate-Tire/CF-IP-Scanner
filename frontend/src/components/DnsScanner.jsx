/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';

const DNS_PRESETS = [
    { label: '8.8.8.8 — Google DNS (UDP)', value: '8.8.8.8' },
    { label: '1.1.1.1 — Cloudflare DNS (UDP)', value: '1.1.1.1' },
    { label: 'tcp://8.8.8.8 — Google DNS over TCP', value: 'tcp://8.8.8.8' },
    { label: 'tcp://1.1.1.1:853 — Cloudflare DNS over TLS', value: 'tcp://1.1.1.1:853' },
    { label: 'https://dns.google/dns-query — Google DoH', value: 'https://dns.google/dns-query' },
    { label: 'https://cloudflare-dns.com/dns-query — Cloudflare DoH', value: 'https://cloudflare-dns.com/dns-query' },
];

const FRAGMENT_PRESETS = [
    { label: '⚙️ Custom', length: '', interval: '', id: 'custom' },
    { label: '🇮🇷 Iran MCI (Aggressive)', length: '100-200', interval: '10-30', id: 'iran_mci' },
    { label: '🇮🇷 Iran Irancell (Standard)', length: '50-100', interval: '10-20', id: 'iran_irancell' },
    { label: '🇮🇷 Iran Shatel (Light)', length: '10-30', interval: '1-5', id: 'iran_shatel' },
    { label: '🇨🇳 China GFW', length: '50-100', interval: '20-50', id: 'china_gfw' },
];

const FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random'];

export default function DnsScanner({ onStartAdvanced, isLoading }) {
    const { t } = useTranslation();
    const [config, setConfig] = useState('');
    const [testMode, setTestMode] = useState('dnstt');
    const [localError, setLocalError] = useState(null);

    // DNS specifics
    const [nameserver, setNameserver] = useState('8.8.8.8');
    const [dnsCustom, setDnsCustom] = useState(false);
    const [dnsDomain, setDnsDomain] = useState('example.com');
    // Split specifics
    const [fragmentSize, setFragmentSize] = useState('10-20');
    const [fragmentInterval, setFragmentInterval] = useState('10-20');
    const [fragmentPreset, setFragmentPreset] = useState('custom');
    const [packetMode, setPacketMode] = useState('tlshello');
    // uTLS
    const [fingerprint, setFingerprint] = useState('chrome');

    const handlePresetChange = (presetId) => {
        setFragmentPreset(presetId);
        const preset = FRAGMENT_PRESETS.find(p => p.id === presetId);
        if (preset && presetId !== 'custom') {
            setFragmentSize(preset.length);
            setFragmentInterval(preset.interval);
        }
    };

    const handleStart = () => {
        setLocalError(null);
        if (!config) {
            setLocalError(t('dnsScanner.errorNoConfig', 'Please paste a valid Xray/V2ray config first.'));
            return;
        }

        const payload = {
            vless_config: config,
            mode: 'dns_tunnel',
            target_ip: '1.1.1.1',
            test_mode: testMode,
            nameserver: testMode === 'dnstt' ? nameserver : null,
            dns_domain: testMode === 'dnstt' ? dnsDomain : null,
            fragment_size: testMode === 'split' ? fragmentSize : null,
            fragment_interval: testMode === 'split' ? fragmentInterval : null,
            fragment_packets: testMode === 'split' ? packetMode : null,
            utls_fingerprint: fingerprint,
        };

        onStartAdvanced(payload, 'dns_tunnel');
    };

    const inputClass = (color = 'neon-purple') =>
        `w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-${color} focus:ring-1 focus:ring-${color} outline-none font-mono focus:shadow-[0_0_15px_rgba(${color === 'neon-purple' ? '188,19,254' : '0,243,255'},0.2)] transition-all`;

    return (
        <div className="glass-panel p-6 neon-border relative overflow-hidden animate-in fade-in zoom-in duration-500">
            <div className="absolute top-0 right-0 w-64 h-64 bg-neon-purple/5 rounded-full blur-[100px] pointer-events-none"></div>

            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-neon-purple/10 flex items-center justify-center border border-neon-purple/30 shadow-[0_0_15px_rgba(188,19,254,0.3)]">
                    <svg className="w-5 h-5 text-neon-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path>
                    </svg>
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400">
                        {t('dnsScanner.title')}
                    </h2>
                    <p className="text-sm text-gray-400 font-medium">{t('dnsScanner.subtitle')}</p>
                </div>
            </div>

            <div className="space-y-6 relative z-10">
                {/* Mode Selector */}
                <div>
                    <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-3">{t('dnsScanner.testOption')}</label>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setTestMode('dnstt')}
                            className={`flex-1 py-3 rounded-xl border font-bold transition-all text-sm flex flex-col items-center justify-center gap-1 ${testMode === 'dnstt'
                                ? 'bg-neon-purple/20 border-neon-purple text-neon-purple shadow-[0_0_15px_rgba(188,19,254,0.3)]'
                                : 'bg-[#000000]/40 border-gray-700 text-gray-400 hover:border-gray-500'
                                }`}
                        >
                            <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                            <span>{t('dnsScanner.dnstt')}</span>
                        </button>
                        <button
                            onClick={() => setTestMode('split')}
                            className={`flex-1 py-3 rounded-xl border font-bold transition-all text-sm flex flex-col items-center justify-center gap-1 ${testMode === 'split'
                                ? 'bg-neon-blue/20 border-neon-blue text-neon-blue shadow-[0_0_15px_rgba(0,243,255,0.3)]'
                                : 'bg-[#000000]/40 border-gray-700 text-gray-400 hover:border-gray-500'
                                }`}
                        >
                            <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2-1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5"></path></svg>
                            <span>{t('dnsScanner.tlsSplit')}</span>
                        </button>
                    </div>
                </div>

                {/* Specific Options based on Mode */}
                {testMode === 'dnstt' ? (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        {/* DNS Server Dropdown */}
                        <div>
                            <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-2">{t('dnsScanner.nameserver')}</label>
                            {!dnsCustom ? (
                                <select
                                    className="w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none font-mono transition-all cursor-pointer"
                                    value={nameserver}
                                    onChange={e => {
                                        if (e.target.value === '__custom__') {
                                            setDnsCustom(true);
                                            setNameserver('');
                                        } else {
                                            setNameserver(e.target.value);
                                        }
                                    }}
                                >
                                    {DNS_PRESETS.map(p => (
                                        <option key={p.value} value={p.value}>{p.label}</option>
                                    ))}
                                    <option value="__custom__">✏️ {t('dnsScanner.customDns', 'Custom DNS Server...')}</option>
                                </select>
                            ) : (
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        className="flex-1 bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none font-mono transition-all"
                                        value={nameserver}
                                        onChange={e => setNameserver(e.target.value)}
                                        placeholder="tcp://1.1.1.1:853 or https://dns.google/dns-query"
                                    />
                                    <button onClick={() => { setDnsCustom(false); setNameserver('8.8.8.8'); }} className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-400 hover:text-white text-xs font-bold transition-all">✕</button>
                                </div>
                            )}
                            <p className="text-[10px] text-gray-500 mt-1">{t('dnsScanner.nameserverDesc')}</p>
                        </div>
                        {/* Test Domain */}
                        <div>
                            <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-2">{t('dnsScanner.testDomain')}</label>
                            <input
                                type="text"
                                className="w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none font-mono transition-all"
                                value={dnsDomain}
                                onChange={e => setDnsDomain(e.target.value)}
                                placeholder="example.com"
                            />
                            <p className="text-[10px] text-gray-500 mt-1">{t('dnsScanner.testDomainDesc')}</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        {/* Fragment Preset Selector */}
                        <div>
                            <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-2">{t('dnsScanner.ispPreset', 'ISP DPI Preset')}</label>
                            <div className="grid grid-cols-3 gap-2">
                                {FRAGMENT_PRESETS.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => handlePresetChange(p.id)}
                                        className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all ${fragmentPreset === p.id
                                            ? 'bg-neon-blue/20 border-neon-blue text-neon-blue shadow-[0_0_10px_rgba(0,243,255,0.2)]'
                                            : 'bg-black/40 border-gray-700 text-gray-400 hover:border-gray-500'
                                            }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Packet Mode Toggle */}
                        <div>
                            <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-2">{t('dnsScanner.packetMode', 'Packet Fragmentation Mode')}</label>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setPacketMode('tlshello')}
                                    className={`flex-1 py-2.5 rounded-lg border text-xs font-bold transition-all ${packetMode === 'tlshello'
                                        ? 'bg-neon-blue/20 border-neon-blue text-neon-blue'
                                        : 'bg-black/40 border-gray-700 text-gray-400 hover:border-gray-500'
                                        }`}
                                >
                                    🎯 tlshello <span className="text-[10px] opacity-60">{t('dnsScanner.recommended', '(Recommended)')}</span>
                                </button>
                                <button
                                    onClick={() => setPacketMode('1-3')}
                                    className={`flex-1 py-2.5 rounded-lg border text-xs font-bold transition-all ${packetMode === '1-3'
                                        ? 'bg-neon-blue/20 border-neon-blue text-neon-blue'
                                        : 'bg-black/40 border-gray-700 text-gray-400 hover:border-gray-500'
                                        }`}
                                >
                                    📦 1-3 <span className="text-[10px] opacity-60">{t('dnsScanner.broader', '(Broader)')}</span>
                                </button>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1">{t('dnsScanner.packetModeDesc', 'tlshello splits only the TLS handshake. 1-3 splits the first 1-3 data writes.')}</p>
                        </div>

                        {/* Manual Fragment Inputs */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-2">{t('dnsScanner.fragmentSize')}</label>
                                <input
                                    type="text"
                                    className="w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-neon-blue focus:ring-1 focus:ring-neon-blue outline-none font-mono transition-all"
                                    value={fragmentSize}
                                    onChange={e => { setFragmentSize(e.target.value); setFragmentPreset('custom'); }}
                                    placeholder="10-20"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">{t('dnsScanner.fragmentSizeDesc')}</p>
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-2">{t('dnsScanner.fragmentInterval')}</label>
                                <input
                                    type="text"
                                    className="w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-neon-blue focus:ring-1 focus:ring-neon-blue outline-none font-mono transition-all"
                                    value={fragmentInterval}
                                    onChange={e => { setFragmentInterval(e.target.value); setFragmentPreset('custom'); }}
                                    placeholder="10-20"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">{t('dnsScanner.fragmentIntervalDesc')}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* uTLS Fingerprint Selector — Shared between both modes */}
                <div>
                    <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-2">{t('dnsScanner.fingerprint', 'TLS Browser Fingerprint (uTLS)')}</label>
                    <div className="flex flex-wrap gap-2">
                        {FINGERPRINTS.map(fp => (
                            <button
                                key={fp}
                                onClick={() => setFingerprint(fp)}
                                className={`px-3 py-1.5 rounded-lg border text-xs font-bold capitalize transition-all ${fingerprint === fp
                                    ? 'bg-neon-purple/20 border-neon-purple text-neon-purple shadow-[0_0_10px_rgba(188,19,254,0.2)]'
                                    : 'bg-black/40 border-gray-700 text-gray-400 hover:border-gray-500'
                                    }`}
                            >
                                {fp === 'chrome' ? '🌐 ' : fp === 'firefox' ? '🦊 ' : fp === 'safari' ? '🍎 ' : fp === 'ios' ? '📱 ' : fp === 'android' ? '🤖 ' : fp === 'edge' ? '🔷 ' : '🎲 '}
                                {fp}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{t('dnsScanner.fingerprintDesc', 'Mimics real browser TLS handshakes to evade DPI fingerprint detection.')}</p>
                </div>

                {/* Base Config Input */}
                <div>
                    <label className="block text-gray-400 text-xs font-bold tracking-widest uppercase mb-2">{t('dnsScanner.vlessConfig')}</label>
                    <textarea
                        className="w-full bg-[#0d0d12] border border-gray-700 rounded-xl p-4 text-white text-sm focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none font-mono h-32 resize-none focus:shadow-[0_0_15px_rgba(188,19,254,0.2)] transition-all"
                        placeholder="vless://..."
                        value={config}
                        onChange={e => setConfig(e.target.value)}
                    ></textarea>
                </div>

                {localError && (
                    <div className="text-red-500 text-xs font-bold text-center mb-[-10px] animate-pulse">
                        ⚠️ {localError}
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleStart}
                    disabled={isLoading}
                    className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${isLoading
                        ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                        : 'bg-white text-black hover:bg-gray-200 shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_30px_rgba(255,255,255,0.6)]'
                        }`}
                >
                    {isLoading ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {t('dnsScanner.testing')}
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            {t('dnsScanner.startScanner')}
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
