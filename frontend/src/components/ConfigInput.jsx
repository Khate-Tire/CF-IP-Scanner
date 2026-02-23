import React, { useState } from 'react';
import { fetchConfigFromUrl, API_URL } from '../api';
import GeoMap from './GeoMap';
import { useTranslation } from '../i18n/LanguageContext';

export default function ConfigInput({ onStartScan, isLoading, useSystemProxy }) {
    const { t } = useTranslation();
    const [config, setConfig] = useState('');
    const [useManual, setUseManual] = useState(false);
    const [manualIps, setManualIps] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Sub Link State
    const [subUrl, setSubUrl] = useState('');
    const [isFetching, setIsFetching] = useState(false);

    // Settings
    const [stopAfter, setStopAfter] = useState(10);
    const [concurrency, setConcurrency] = useState(5);
    const [maxPing, setMaxPing] = useState(800);
    const [maxJitter, setMaxJitter] = useState(200);
    const [minDown, setMinDown] = useState(0);
    const [minUp, setMinUp] = useState(0);
    const [ipVersion, setIpVersion] = useState("all");
    const [verifyTls, setVerifyTls] = useState(false);

    // Phase 26: Strictness Profile
    const [strictness, setStrictness] = useState("average");

    // IP Source
    const [ipSource, setIpSource] = useState("official");
    const [customUrl, setCustomUrl] = useState("");
    const [targetCountry, setTargetCountry] = useState("");

    // Ports
    const AVAILABLE_PORTS = [443, 80, 8443, 8080, 2053, 2083, 2087, 2096];
    const [testPorts, setTestPorts] = useState([]);

    const togglePort = (port) => {
        if (testPorts.includes(port)) {
            setTestPorts(testPorts.filter(p => p !== port));
        } else {
            setTestPorts([...testPorts, port]);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        // Apply strictness overrides
        let finalMaxPing = maxPing;
        let finalMaxJitter = maxJitter;
        let finalMinDown = minDown;
        let finalMinUp = minUp;

        if (strictness === 'hard') {
            finalMaxPing = 300;
            finalMaxJitter = 100;
            finalMinDown = 10;
            finalMinUp = 2;
        } else if (strictness === 'average') {
            finalMaxPing = 600;
            finalMaxJitter = 300;
            finalMinDown = 2;
            finalMinUp = 0.5;
        } else if (strictness === 'minimum') {
            finalMaxPing = 1500;
            finalMaxJitter = 800;
            finalMinDown = 0.1;
            finalMinUp = 0.1;
        }

        onStartScan(config, useManual ? manualIps.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : null, {
            stopAfter, concurrency, maxPing: finalMaxPing, maxJitter: finalMaxJitter, minDown: finalMinDown, minUp: finalMinUp, ipVersion, ipSource, customUrl, testPorts, verifyTls, targetCountry
        });
    };

    const handleFetch = async () => {
        if (!subUrl) return;
        setIsFetching(true);
        const res = await fetchConfigFromUrl(subUrl, useSystemProxy);
        setIsFetching(false);
        if (res && res.configs && res.configs.length > 0) {
            const randomConfig = res.configs[Math.floor(Math.random() * res.configs.length)];
            setConfig(randomConfig);
            alert(`Fetched ${res.configs.length} configs. Selected one randomly.`);
        } else {
            alert(res?.error || "Failed to fetch configs");
        }
    };

    const handleAutoScan = async () => {
        setIsFetching(true);
        const autoUrl = import.meta.env.VITE_AUTO_SUB_URL || "";
        const fallbackConfig = import.meta.env.VITE_FALLBACK_CONFIG || "";

        let fetchedConfig = null;

        // Priority 1: If user already has a valid config typed in, use it directly
        if (config && config.startsWith('vless://')) {
            fetchedConfig = config;
        }

        // Priority 2: If user provided a subscription URL, fetch from it
        if (!fetchedConfig && subUrl) {
            try {
                const res = await fetchConfigFromUrl(subUrl, useSystemProxy);
                if (res && res.configs && res.configs.length > 0) {
                    fetchedConfig = res.configs[Math.floor(Math.random() * res.configs.length)];
                }
            } catch (e) {
                console.warn("Failed to fetch from user's subscription URL:", e);
            }
        }

        // Priority 3: Use the working DB tunnel config (same config that connected DB)
        if (!fetchedConfig) {
            try {
                const res = await fetch(`${API_URL}/working-config`);
                const data = await res.json();
                if (data.config && data.config.startsWith('vless://')) {
                    fetchedConfig = data.config;
                    console.log("Using working DB tunnel config for scan");
                }
            } catch (e) {
                console.warn("Could not fetch working config:", e);
            }
        }

        // Priority 4: Try community GitHub URL (needs proxy to bypass ISP block)
        if (!fetchedConfig) {
            try {
                const res = await fetchConfigFromUrl(autoUrl, useSystemProxy);
                if (res && res.configs && res.configs.length > 0) {
                    fetchedConfig = res.configs[Math.floor(Math.random() * res.configs.length)];
                }
            } catch (e) {
                console.warn("Auto fetch from community URL failed.");
            }
        }

        // Priority 5: Use fallback config from environment variable
        if (!fetchedConfig && fallbackConfig) {
            fetchedConfig = fallbackConfig;
        }

        // If all sources failed, prompt the user
        if (!fetchedConfig) {
            setIsFetching(false);
            alert("Could not fetch a config automatically. Please paste a VLESS config or subscription URL manually.");
            return;
        }

        setIsFetching(false);
        setConfig(fetchedConfig);

        // Force settings for the smartest search
        setIpSource("gold_ips");
        setUseManual(false);

        // Start scan immediately
        onStartScan(fetchedConfig, null, {
            stopAfter: 10,
            concurrency: 10,
            maxPing: 500,
            maxJitter: 200,
            minDown: 5,
            minUp: 0,
            ipVersion: "all",
            ipSource: "gold_ips",
            customUrl: "",
            testPorts: [],
            verifyTls: false,
            targetCountry: ""
        });
    };

    return (
        <div className="glass-panel p-6 max-w-2xl mx-auto mt-10 neon-border">
            <h2 className="text-2xl font-bold mb-4 text-neon-blue drop-shadow-[0_0_5px_rgba(0,243,255,0.8)]">
                {t('config.configLabel')}
            </h2>
            <div className="mb-4">
                <label className="block text-gray-400 text-sm mb-2">{t('config.importSub')}</label>
                <div className="flex gap-2">
                    <input
                        type="url"
                        className="input-field flex-1 text-sm font-mono"
                        placeholder="https://..."
                        value={subUrl}
                        onChange={(e) => setSubUrl(e.target.value)}
                    />
                    <button
                        type="button"
                        onClick={handleFetch}
                        disabled={isFetching || !subUrl}
                        className={`btn-secondary whitespace-nowrap ${isFetching ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isFetching ? t('config.fetching') : t('config.fetchConfig')}
                    </button>
                </div>
            </div>
            <form onSubmit={handleSubmit}>
                <div className="mb-4">
                    <label className="block text-gray-400 text-sm mb-2">{t('config.vlessUrl')}</label>
                    <textarea
                        className="input-field h-24 font-mono text-sm"
                        placeholder="vless://..."
                        value={config}
                        onChange={(e) => setConfig(e.target.value)}
                        required
                    />
                </div>

                <div className="mb-4">
                    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-neon-blue underline mb-2">
                        {showAdvanced ? t('config.hideAdvanced') : t('config.showAdvanced')}
                    </button>

                    {showAdvanced && (
                        <div className="grid grid-cols-2 gap-4 mb-4 p-4 border border-white/10 rounded-lg bg-black/30">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">{t('config.threads')}</label>
                                <input type="number" value={concurrency} onChange={e => setConcurrency(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">{t('config.stopAfterLabel')}</label>
                                <input type="number" value={stopAfter} onChange={e => setStopAfter(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">{t('config.maxPing')}</label>
                                <input type="number" value={maxPing} onChange={e => setMaxPing(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">{t('config.maxJitter')}</label>
                                <input type="number" value={maxJitter} onChange={e => setMaxJitter(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">{t('config.minDownload')}</label>
                                <input type="number" value={minDown} onChange={e => setMinDown(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">{t('config.minUpload')}</label>
                                <input type="number" value={minUp} onChange={e => setMinUp(parseInt(e.target.value))} className="input-field py-1" />
                            </div>
                            <div className="col-span-2 mt-2">
                                <label className="block text-gray-400 text-xs mb-1">{t('config.ipVersion')}</label>
                                <select
                                    value={ipVersion}
                                    onChange={e => setIpVersion(e.target.value)}
                                    className="input-field py-1"
                                >
                                    <option value="all">{t('config.bothIpv')}</option>
                                    <option value="ipv4">{t('config.ipv4Only')}</option>
                                    <option value="ipv6">{t('config.ipv6Only')}</option>
                                </select>
                            </div>

                            <div className="col-span-2 mt-4 border-t border-white/10 pt-4">
                                <label className="flex items-center space-x-2 cursor-pointer text-gray-300 mb-4">
                                    <input
                                        type="checkbox"
                                        checked={verifyTls}
                                        onChange={(e) => setVerifyTls(e.target.checked)}
                                        className="w-4 h-4 accent-red-500"
                                    />
                                    <span className="text-sm font-bold text-red-500 bg-red-500/10 px-2 py-1 rounded inline-flex items-center gap-1 object-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-1.998A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clipRule="evenodd" />
                                        </svg>
                                        {t('config.strictTls')}
                                    </span>
                                </label>

                                <label className="block text-gray-400 text-xs mb-2">{t('config.targetPorts')}</label>
                                <div className="flex flex-wrap gap-2">
                                    {AVAILABLE_PORTS.map(port => (
                                        <button
                                            key={port}
                                            type="button"
                                            onClick={() => togglePort(port)}
                                            className={`px-3 py-1 text-xs rounded-full border transition-all ${testPorts.includes(port)
                                                ? 'bg-neon-blue/20 text-neon-blue border-neon-blue shadow-[0_0_8px_rgba(0,243,255,0.4)]'
                                                : 'bg-black/40 text-gray-400 border-white/10 hover:border-white/30'
                                                }`}
                                        >
                                            {port}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="col-span-2 mt-4">
                                <label className="block text-gray-400 text-xs mb-2">{t('config.geoTarget')}</label>
                                <GeoMap selectedCountry={targetCountry} onSelectCountry={setTargetCountry} />
                                <p className="text-gray-500 text-[10px] mt-1">{t('config.geoHint')}</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mb-4">
                    <label className="flex items-center space-x-2 cursor-pointer text-gray-300 mb-2">
                        <input
                            type="checkbox"
                            checked={useManual}
                            onChange={(e) => setUseManual(e.target.checked)}
                            className="w-4 h-4 accent-neon-blue"
                        />
                        <span>{t('config.useManual')}</span>
                    </label>

                    {useManual ? (
                        <textarea
                            className="input-field h-24 font-mono text-sm animate-in fade-in slide-in-from-top-2"
                            placeholder="1.1.1.1, discord.com, shopify.com..."
                            value={manualIps}
                            onChange={(e) => setManualIps(e.target.value)}
                        />
                    ) : (
                        <div className="p-4 border border-white/10 rounded-lg bg-black/40 mb-4 animate-in fade-in slide-in-from-top-2">
                            <label className="block text-gray-400 text-sm mb-3">{t('config.ipGenSource')}</label>
                            <div className="flex flex-col gap-3">
                                <label className="flex items-center space-x-2 cursor-pointer text-gray-300 text-sm">
                                    <input type="radio" name="ipsource" value="official" checked={ipSource === 'official'} onChange={() => setIpSource('official')} className="accent-neon-blue" />
                                    <span>{t('config.srcOfficial')}</span>
                                </label>
                                <label className="flex items-center space-x-2 cursor-pointer text-gray-300 text-sm">
                                    <input type="radio" name="ipsource" value="smart_history" checked={ipSource === 'smart_history'} onChange={() => setIpSource('smart_history')} className="accent-neon-blue" />
                                    <span>{t('config.srcHistory')}</span>
                                </label>
                                <label className="flex items-center space-x-2 cursor-pointer text-gray-300 text-sm">
                                    <input type="radio" name="ipsource" value="gold_ips" checked={ipSource === 'gold_ips'} onChange={() => setIpSource('gold_ips')} className="accent-neon-blue" />
                                    <span><strong className="text-amber-400 text-xs bg-amber-400/10 border border-amber-400/30 px-1 rounded mr-1">ULTIMATE</strong> {t('config.srcGold')}</span>
                                </label>
                                <label className="flex items-center space-x-2 cursor-pointer text-gray-300 text-sm">
                                    <input type="radio" name="ipsource" value="community_gold" checked={ipSource === 'community_gold'} onChange={() => setIpSource('community_gold')} className="accent-neon-purple" />
                                    <span><strong className="text-neon-purple text-xs bg-neon-purple/10 border border-neon-purple/30 px-1 rounded mr-1">GLOBAL</strong> {t('config.srcCommunity')}</span>
                                </label>
                                <label className="flex items-center space-x-2 cursor-pointer text-gray-300 text-sm">
                                    <input type="radio" name="ipsource" value="auto_scrape" checked={ipSource === 'auto_scrape'} onChange={() => setIpSource('auto_scrape')} className="accent-neon-blue" />
                                    <span>{t('config.srcScrape')}</span>
                                </label>
                                <label className="flex items-center space-x-2 cursor-pointer text-gray-300 text-sm">
                                    <input type="radio" name="ipsource" value="custom_url" checked={ipSource === 'custom_url'} onChange={() => setIpSource('custom_url')} className="accent-neon-blue" />
                                    <span>{t('config.srcCustom')}</span>
                                </label>
                            </div>
                            {ipSource === 'custom_url' && (
                                <input
                                    type="url"
                                    className="input-field mt-3 text-sm font-mono w-full"
                                    placeholder="https://raw.githubusercontent.com/.../ips.txt"
                                    value={customUrl}
                                    onChange={(e) => setCustomUrl(e.target.value)}
                                    required={ipSource === 'custom_url'}
                                />
                            )}
                        </div>
                    )}
                </div>

                <div className="flex gap-4">
                    <button
                        type="button"
                        onClick={handleAutoScan}
                        disabled={isLoading || isFetching}
                        className={`w-1/2 py-4 rounded-xl font-black text-lg transition-transform flex items-center justify-center gap-2 border-none
                            ${isLoading ? 'bg-[#1a1a1a] text-gray-500 cursor-not-allowed' : 'text-black bg-gradient-to-r from-neon-green to-[#00ff88] hover:scale-[1.02] shadow-[0_0_20px_rgba(57,255,20,0.4)]'}`}
                    >
                        {isLoading ? t('config.autoScanning') : t('config.autoScan')}
                    </button>

                    <div className="w-1/2 flex items-stretch">
                        <div className="relative w-2/3">
                            <select
                                value={strictness}
                                onChange={(e) => setStrictness(e.target.value)}
                                className="w-full h-full bg-[#0a0a0a] text-neon-blue border-y-2 border-l-2 border-neon-blue/50 rounded-l-xl p-3 font-bold outline-none appearance-none cursor-pointer focus:border-neon-blue transition-colors pl-4 pr-10"
                            >
                                <option value="minimum">{t('config.strictMin')}</option>
                                <option value="average">{t('config.strictAvg')}</option>
                                <option value="hard">{t('config.strictHard')}</option>
                            </select>
                            <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-neon-blue">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading || !config || isFetching}
                            className={`w-1/3 rounded-r-xl font-black transition-all flex flex-col items-center justify-center leading-tight
                                ${isLoading || !config ? 'bg-[#1a1a1a] text-gray-500 cursor-not-allowed border-none' : 'text-black bg-neon-blue hover:bg-cyan-400 shadow-[0_0_15px_rgba(0,243,255,0.4)] hover:shadow-[0_0_25px_rgba(0,243,255,0.8)]'}`}
                        >
                            {isLoading ? '...' : (
                                <>
                                    <span>{t('config.startManual').split(' ')[0]}</span>
                                    <span>{t('config.startManual').split(' ').slice(1).join(' ')}</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
