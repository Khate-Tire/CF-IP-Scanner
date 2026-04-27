/* Copyright (c) 2026 Khate Tire */
import React, { useState, useEffect } from 'react';
import { fetchConfigFromUrl, API_URL, testConfigRemote } from '../api';
import GeoMap from './GeoMap';
import { useTranslation } from '../i18n/LanguageContext';
import { toast } from 'react-hot-toast';

export default function ConfigInput({ onStartScan, isLoading, useSystemProxy, autoStartSignal, scannerPreset, onPresetConsumed }) {
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

    // Auto SNI-fronting fallback (retry IP with clean SNI when ISP DPI blocks original SNI)
    const [sniFallbackEnabled, setSniFallbackEnabled] = useState(false);
    const [sniFallbackListText, setSniFallbackListText] = useState('');
    const [sniFallbackMaxTries, setSniFallbackMaxTries] = useState(3);

    // Phase 26: Strictness Profile
    const [strictness, setStrictness] = useState("average");

    // IP Source
    const [ipSource, setIpSource] = useState("official");
    const [customUrl, setCustomUrl] = useState("");
    const [targetCountry, setTargetCountry] = useState("");

    // Ports
    const AVAILABLE_PORTS = [443, 80, 8443, 8080, 2053, 2083, 2087, 2096];
    const [testPorts, setTestPorts] = useState([]);

    // Config Test State
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

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

        const sniFallbackList = sniFallbackListText
            .split(/[\n,]+/)
            .map(s => s.trim())
            .filter(Boolean);

        onStartScan(config, useManual ? manualIps.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : null, {
            stopAfter, concurrency, maxPing: finalMaxPing, maxJitter: finalMaxJitter, minDown: finalMinDown, minUp: finalMinUp, ipVersion, ipSource, customUrl, testPorts, verifyTls, targetCountry,
            sniFallbackEnabled, sniFallbackList, sniFallbackMaxTries
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
            toast.success(`Fetched ${res.configs.length} configs. Selected one randomly.`);
        } else {
            toast.error(res?.error || "Failed to fetch configs");
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
            toast.error("Could not fetch a config automatically. Please paste a VLESS config or subscription URL manually.");
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

    React.useEffect(() => {
        if (autoStartSignal > 0 && !isFetching && !isLoading) {
            handleAutoScan();
        }
    }, [autoStartSignal]);

    // Apply preset coming from Analytics dashboard (clickable port / country)
    useEffect(() => {
        if (!scannerPreset) return;
        if (Array.isArray(scannerPreset.testPorts) && scannerPreset.testPorts.length) {
            setTestPorts(scannerPreset.testPorts);
            setShowAdvanced(true);
        }
        if (typeof scannerPreset.targetCountry === 'string') {
            setTargetCountry(scannerPreset.targetCountry.toUpperCase());
            setShowAdvanced(true);
        }
        if (scannerPreset.ipSource) {
            setIpSource(scannerPreset.ipSource);
        }
        onPresetConsumed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scannerPreset]);

    const handleTestConfig = async () => {
        if (!config || isTesting) return;
        const validPrefixes = ['vless://', 'vmess://', 'trojan://', 'ss://'];
        if (!validPrefixes.some(p => config.trim().startsWith(p))) {
            toast.error('Please enter a valid VLESS, VMess, Trojan, or Shadowsocks config.');
            return;
        }
        setIsTesting(true);
        setTestResult(null);
        try {
            const data = await testConfigRemote(config.trim());
            setTestResult(data);
            if (data.success) {
                toast.success('Config is working!');
            } else {
                toast.error(data.error || 'Config is not working.');
            }
        } catch (e) {
            setTestResult({ success: false, error: 'Test failed unexpectedly.' });
            toast.error('Test failed unexpectedly.');
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="glass-panel max-w-2xl mx-auto mt-10 neon-border overflow-hidden">
            {/* Header with gradient accent bar */}
            <div className="relative px-6 pt-6 pb-4">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-neon-blue to-transparent opacity-60"></div>
                <div className="flex items-center gap-3 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-neon-blue/10 border border-neon-blue/30 flex items-center justify-center">
                        <svg className="w-4 h-4 text-neon-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    </div>
                    <h2 className="text-xl font-bold text-neon-blue">
                        {t('config.configLabel')}
                    </h2>
                </div>
            </div>

            <div className="px-6 pb-6">
            {/* Subscription URL */}
            <div className="mb-5">
                <label className="block text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">{t('config.importSub')}</label>
                <div className="flex gap-2">
                    <input
                        type="url"
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono text-neon-blue placeholder-white/20 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/20 transition-all"
                        placeholder="https://..."
                        value={subUrl}
                        onChange={(e) => setSubUrl(e.target.value)}
                    />
                    <button
                        type="button"
                        onClick={handleFetch}
                        disabled={isFetching || !subUrl}
                        className={`px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap border transition-all ${isFetching ? 'opacity-50 cursor-not-allowed bg-white/5 border-white/10 text-gray-500' : 'bg-white/[0.05] border-white/20 text-gray-300 hover:bg-neon-blue/10 hover:border-neon-blue/40 hover:text-neon-blue'}`}
                    >
                        {isFetching ? t('config.fetching') : t('config.fetchConfig')}
                    </button>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                {/* VLESS URL */}
                <div className="mb-5">
                    <label className="block text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">{t('config.vlessUrl')}</label>
                    <textarea
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 h-24 font-mono text-sm text-neon-blue placeholder-white/20 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/20 transition-all resize-none"
                        placeholder="vless://..."
                        value={config}
                        onChange={(e) => { setConfig(e.target.value); setTestResult(null); }}
                        required
                    />
                    {/* Test Config Button */}
                    <button
                        type="button"
                        onClick={handleTestConfig}
                        disabled={isTesting || !config}
                        className={`mt-2 w-full py-2.5 rounded-xl text-sm font-bold border transition-all flex items-center justify-center gap-2
                            ${isTesting
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 cursor-not-allowed'
                                : !config
                                    ? 'bg-white/[0.02] border-white/[0.06] text-gray-600 cursor-not-allowed'
                                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50 hover:shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                            }`}
                    >
                        {isTesting ? (
                            <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                                Testing Config on Server...
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                                🔍 {t('config.verifyConfig', 'Verify Config (Not a Scan)')}
                            </>
                        )}
                    </button>

                    {/* Test Result Card */}
                    {testResult && (
                        <div className={`mt-3 rounded-xl border overflow-hidden animate-in fade-in slide-in-from-top-2 ${testResult.success ? 'border-neon-green/30 bg-neon-green/[0.05]' : 'border-red-500/30 bg-red-500/[0.05]'}`}>
                            {/* Result Header */}
                            <div className={`px-4 py-2.5 flex items-center gap-2 ${testResult.success ? 'bg-neon-green/10' : 'bg-red-500/10'}`}>
                                {testResult.success ? (
                                    <svg className="w-5 h-5 text-neon-green" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                ) : (
                                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                )}
                                <span className={`text-sm font-bold ${testResult.success ? 'text-neon-green' : 'text-red-400'}`}>
                                    {testResult.success ? t('config.configWorking', 'Config is Working!') : t('config.configNotWorking', 'Config Not Working')}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setTestResult(null)}
                                    className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>

                            {testResult.success && testResult.result ? (
                                <div className="px-4 py-3">
                                    {/* Speed Metrics Grid */}
                                    <div className="grid grid-cols-4 gap-3 mb-3">
                                        <div className="text-center">
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('config.ping', 'Ping')}</div>
                                            <div className={`text-lg font-black ${testResult.result.ping < 200 ? 'text-neon-green' : testResult.result.ping < 500 ? 'text-amber-400' : 'text-red-400'}`}>
                                                {testResult.result.ping}<span className="text-[10px] font-normal text-gray-500 ml-0.5">ms</span>
                                            </div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('config.jitter', 'Jitter')}</div>
                                            <div className={`text-lg font-black ${testResult.result.jitter < 50 ? 'text-neon-green' : testResult.result.jitter < 150 ? 'text-amber-400' : 'text-red-400'}`}>
                                                {testResult.result.jitter}<span className="text-[10px] font-normal text-gray-500 ml-0.5">ms</span>
                                            </div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('config.download', 'Download')}</div>
                                            <div className="text-lg font-black text-neon-blue">
                                                {testResult.result.download_speed >= 1024
                                                    ? (testResult.result.download_speed / 1024).toFixed(1)
                                                    : testResult.result.download_speed}
                                                <span className="text-[10px] font-normal text-gray-500 ml-0.5">
                                                    {testResult.result.download_speed >= 1024 ? 'MB/s' : 'KB/s'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('config.upload', 'Upload')}</div>
                                            <div className="text-lg font-black text-[#bc13fe]">
                                                {testResult.result.upload_speed >= 1024
                                                    ? (testResult.result.upload_speed / 1024).toFixed(1)
                                                    : testResult.result.upload_speed}
                                                <span className="text-[10px] font-normal text-gray-500 ml-0.5">
                                                    {testResult.result.upload_speed >= 1024 ? 'MB/s' : 'KB/s'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Connection Details */}
                                    <div className="flex flex-wrap gap-2 text-[10px]">
                                        {testResult.result.protocol && (
                                            <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400 uppercase font-bold">
                                                {testResult.result.protocol}
                                            </span>
                                        )}
                                        {testResult.result.transport && (
                                            <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400 uppercase font-bold">
                                                {testResult.result.transport}
                                            </span>
                                        )}
                                        {testResult.result.tls && testResult.result.tls !== 'none' && (
                                            <span className="px-2 py-0.5 rounded-full bg-neon-green/10 border border-neon-green/20 text-neon-green uppercase font-bold">
                                                {testResult.result.tls}
                                            </span>
                                        )}
                                        {testResult.result.country && (
                                            <span className="px-2 py-0.5 rounded-full bg-neon-blue/10 border border-neon-blue/20 text-neon-blue font-bold">
                                                {testResult.result.country}{testResult.result.city ? ` · ${testResult.result.city}` : ''}
                                            </span>
                                        )}
                                        {testResult.result.isp && (
                                            <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400 font-medium">
                                                {testResult.result.isp}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ) : !testResult.success && (
                                <div className="px-4 py-3">
                                    <p className="text-sm text-red-300/80">
                                        {testResult.error || t('config.errorNotWorking', 'It seems this config is not working. Please check the config or try another one.')}
                                    </p>
                                    {testResult.details && testResult.details.ping > 0 && (
                                        <p className="text-xs text-gray-500 mt-1">
                                            {t('config.tunnelFailed', { ping: testResult.details.ping }, `Server reachable (ping: ${testResult.details.ping}ms) but proxy tunnel failed.`)}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Advanced Settings Toggle */}
                <div className="mb-5">
                    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="group flex items-center gap-2 text-xs font-semibold text-neon-blue/70 hover:text-neon-blue transition-colors">
                        <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
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

                                {/* Auto SNI-fronting fallback */}
                                <div className="mb-4 p-3 rounded border border-emerald-500/20 bg-emerald-500/5">
                                    <label className="flex items-start gap-2 cursor-pointer text-gray-300">
                                        <input
                                            type="checkbox"
                                            checked={sniFallbackEnabled}
                                            onChange={(e) => setSniFallbackEnabled(e.target.checked)}
                                            className="w-4 h-4 accent-emerald-500 mt-0.5"
                                        />
                                        <span className="flex-1">
                                            <span className="text-sm font-bold text-emerald-300 inline-flex items-center gap-1">
                                                🛡️ {t('config.sniFallback', 'Auto-rotate SNI on failure (DPI bypass)')}
                                            </span>
                                            <span className="block text-[11px] text-gray-400 mt-1 leading-snug">
                                                {t('config.sniFallbackDesc', 'If your config\'s SNI is blocked by ISP DPI, retry the same IP with known clean SNIs (Cloudflare-fronted). Skipped for Reality. WS Host header is preserved so Cloudflare Workers still route correctly.')}
                                            </span>
                                        </span>
                                    </label>

                                    {sniFallbackEnabled && (
                                        <div className="mt-3 space-y-2 pl-6">
                                            <div>
                                                <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                                                    {t('config.sniFallbackList', 'Custom SNI list (one per line, leave blank for built-in bank)')}
                                                </label>
                                                <textarea
                                                    value={sniFallbackListText}
                                                    onChange={(e) => setSniFallbackListText(e.target.value)}
                                                    placeholder="speed.cloudflare.com&#10;cdnjs.cloudflare.com&#10;www.icloud.com&#10;discord.com"
                                                    rows={4}
                                                    className="input-field w-full text-xs font-mono"
                                                />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider">
                                                    {t('config.sniFallbackMaxTries', 'Max retries per IP')}
                                                </label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={10}
                                                    value={sniFallbackMaxTries}
                                                    onChange={(e) => setSniFallbackMaxTries(Math.max(1, Math.min(10, Number(e.target.value) || 3)))}
                                                    className="input-field py-0.5 px-2 w-16 text-xs"
                                                />
                                                <span className="text-[10px] text-amber-400/80">
                                                    {t('config.sniFallbackWarn', '(adds ~10s per retry on failed IPs)')}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>

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

                {/* Manual IPs Toggle */}
                <div className="mb-5">
                    <label className="flex items-center gap-2.5 cursor-pointer group">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${useManual ? 'bg-neon-blue border-neon-blue' : 'border-white/20 group-hover:border-white/40'}`}>
                            {useManual && <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                        </div>
                        <input
                            type="checkbox"
                            checked={useManual}
                            onChange={(e) => setUseManual(e.target.checked)}
                            className="sr-only"
                        />
                        <span className="text-sm text-gray-300 font-medium">{t('config.useManual')}</span>
                    </label>

                    {useManual ? (
                        <textarea
                            className="w-full mt-3 bg-black/40 border border-white/10 rounded-xl px-4 py-3 h-24 font-mono text-sm text-neon-blue placeholder-white/20 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/20 transition-all resize-none animate-in fade-in slide-in-from-top-2"
                            placeholder="1.1.1.1, discord.com, shopify.com..."
                            value={manualIps}
                            onChange={(e) => setManualIps(e.target.value)}
                        />
                    ) : (
                        <div className="mt-3 p-4 border border-white/[0.06] rounded-xl bg-black/20 animate-in fade-in slide-in-from-top-2">
                            <label className="block text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">{t('config.ipGenSource')}</label>
                            <div className="grid grid-cols-2 gap-2">
                                {/* Official Cloudflare */}
                                <label className={`group relative flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${ipSource === 'official' ? 'bg-neon-blue/[0.08] border-neon-blue/40 shadow-[0_0_15px_rgba(0,243,255,0.1)]' : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'}`}>
                                    <input type="radio" name="ipsource" value="official" checked={ipSource === 'official'} onChange={() => setIpSource('official')} className="sr-only" />
                                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${ipSource === 'official' ? 'border-neon-blue' : 'border-white/20 group-hover:border-white/40'}`}>
                                        {ipSource === 'official' && <div className="w-2 h-2 rounded-full bg-neon-blue"></div>}
                                    </div>
                                    <span className="text-sm font-semibold text-gray-300 leading-tight">{t('config.srcOfficial')}</span>
                                </label>

                                {/* Smart History */}
                                <label className={`group relative flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${ipSource === 'smart_history' ? 'bg-neon-blue/[0.08] border-neon-blue/40 shadow-[0_0_15px_rgba(0,243,255,0.1)]' : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'}`}>
                                    <input type="radio" name="ipsource" value="smart_history" checked={ipSource === 'smart_history'} onChange={() => setIpSource('smart_history')} className="sr-only" />
                                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${ipSource === 'smart_history' ? 'border-neon-blue' : 'border-white/20 group-hover:border-white/40'}`}>
                                        {ipSource === 'smart_history' && <div className="w-2 h-2 rounded-full bg-neon-blue"></div>}
                                    </div>
                                    <span className="text-sm font-semibold text-gray-300 leading-tight">{t('config.srcHistory')}</span>
                                </label>

                                {/* Gold IPs */}
                                <label className={`group relative flex flex-col p-3 rounded-xl border cursor-pointer transition-all duration-200 ${ipSource === 'gold_ips' ? 'bg-amber-400/[0.08] border-amber-400/40 shadow-[0_0_15px_rgba(251,191,36,0.1)]' : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'}`}>
                                    <input type="radio" name="ipsource" value="gold_ips" checked={ipSource === 'gold_ips'} onChange={() => setIpSource('gold_ips')} className="sr-only" />
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${ipSource === 'gold_ips' ? 'border-amber-400' : 'border-white/20 group-hover:border-white/40'}`}>
                                            {ipSource === 'gold_ips' && <div className="w-2 h-2 rounded-full bg-amber-400"></div>}
                                        </div>
                                        <span className="text-sm font-semibold text-gray-300 leading-tight">{t('config.srcGold')}</span>
                                    </div>
                                    <span className="text-[9px] text-amber-500/80 mt-1.5 uppercase font-black tracking-[0.2em] pl-7">{t('config.ultimateMode', 'Ultimate Mode')}</span>
                                </label>

                                {/* Community Gold */}
                                <label className={`group relative flex flex-col p-3 rounded-xl border cursor-pointer transition-all duration-200 ${ipSource === 'community_gold' ? 'bg-[#bc13fe]/[0.08] border-[#bc13fe]/40 shadow-[0_0_15px_rgba(188,19,254,0.1)]' : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'}`}>
                                    <input type="radio" name="ipsource" value="community_gold" checked={ipSource === 'community_gold'} onChange={() => setIpSource('community_gold')} className="sr-only" />
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${ipSource === 'community_gold' ? 'border-[#bc13fe]' : 'border-white/20 group-hover:border-white/40'}`}>
                                            {ipSource === 'community_gold' && <div className="w-2 h-2 rounded-full bg-[#bc13fe]"></div>}
                                        </div>
                                        <span className="text-sm font-semibold text-gray-300 leading-tight">{t('config.srcCommunity')}</span>
                                    </div>
                                    <span className="text-[9px] text-[#bc13fe]/80 mt-1.5 uppercase font-black tracking-[0.2em] pl-7">{t('config.globalSearch', 'Global Search')}</span>
                                </label>

                                {/* Auto-Scrape */}
                                <label className={`group relative flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${ipSource === 'auto_scrape' ? 'bg-neon-blue/[0.08] border-neon-blue/40 shadow-[0_0_15px_rgba(0,243,255,0.1)]' : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'}`}>
                                    <input type="radio" name="ipsource" value="auto_scrape" checked={ipSource === 'auto_scrape'} onChange={() => setIpSource('auto_scrape')} className="sr-only" />
                                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${ipSource === 'auto_scrape' ? 'border-neon-blue' : 'border-white/20 group-hover:border-white/40'}`}>
                                        {ipSource === 'auto_scrape' && <div className="w-2 h-2 rounded-full bg-neon-blue"></div>}
                                    </div>
                                    <span className="text-sm font-semibold text-gray-300 leading-tight">{t('config.srcScrape')}</span>
                                </label>

                                {/* Fastly CDN */}
                                <label className={`group relative flex flex-col p-3 rounded-xl border cursor-pointer transition-all duration-200 ${ipSource === 'fastly_cdn' ? 'bg-red-500/[0.08] border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'}`}>
                                    <input type="radio" name="ipsource" value="fastly_cdn" checked={ipSource === 'fastly_cdn'} onChange={() => setIpSource('fastly_cdn')} className="sr-only" />
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${ipSource === 'fastly_cdn' ? 'border-red-500' : 'border-white/20 group-hover:border-white/40'}`}>
                                            {ipSource === 'fastly_cdn' && <div className="w-2 h-2 rounded-full bg-red-500"></div>}
                                        </div>
                                        <span className="text-sm font-bold text-red-400 leading-tight">{t('config.fastlyCdn', 'FASTLY CDN')}</span>
                                    </div>
                                    <span className="text-[9px] text-red-500/80 mt-1.5 uppercase font-black tracking-[0.2em] pl-7">{t('config.beta', 'Beta')}</span>
                                </label>

                                {/* Custom URL - full width */}
                                <label className={`col-span-2 group relative flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${ipSource === 'custom_url' ? 'bg-white/[0.05] border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]' : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'}`}>
                                    <input type="radio" name="ipsource" value="custom_url" checked={ipSource === 'custom_url'} onChange={() => setIpSource('custom_url')} className="sr-only" />
                                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${ipSource === 'custom_url' ? 'border-white' : 'border-white/20 group-hover:border-white/40'}`}>
                                        {ipSource === 'custom_url' && <div className="w-2 h-2 rounded-full bg-white"></div>}
                                    </div>
                                    <span className="text-sm font-semibold text-gray-300">{t('config.srcCustom', 'Custom Private IP List URL')}</span>
                                </label>
                            </div>

                            {ipSource === 'fastly_cdn' && (
                                <div className="mt-3 p-3 bg-red-500/[0.06] border border-red-500/20 rounded-xl text-xs text-red-300/80 flex items-start gap-2">
                                    <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>
                                    <span>{t('config.fastlyWarn', 'Ensure your VLESS config uses a Fastly SNI/Host (e.g. fastly.net). Scanning Fastly IPs with Cloudflare configs will fail.')}</span>
                                </div>
                            )}
                            {ipSource === 'custom_url' && (
                                <input
                                    type="url"
                                    className="w-full mt-3 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono text-neon-blue placeholder-white/20 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/20 transition-all"
                                    placeholder="https://raw.githubusercontent.com/.../ips.txt"
                                    value={customUrl}
                                    onChange={(e) => setCustomUrl(e.target.value)}
                                    required={ipSource === 'custom_url'}
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2">
                    {/* Auto Scan */}
                    <button
                        type="button"
                        onClick={handleAutoScan}
                        disabled={isLoading || isFetching}
                        className={`group flex-1 py-3.5 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 border
                            ${isLoading ? 'bg-white/[0.03] text-gray-600 cursor-not-allowed border-white/[0.06]' : 'text-black bg-gradient-to-r from-neon-green to-[#00ff88] hover:scale-[1.01] hover:shadow-[0_0_25px_rgba(57,255,20,0.4)] shadow-[0_0_15px_rgba(57,255,20,0.2)] border-transparent active:scale-[0.99]'}`}
                    >
                        {isLoading ? t('config.autoScanning') : t('config.autoScan')}
                    </button>

                    {/* Strictness + Start Manual */}
                    <div className="flex-1 flex rounded-xl overflow-hidden border border-neon-blue/30">
                        <div className="relative flex-1">
                            <select
                                value={strictness}
                                onChange={(e) => setStrictness(e.target.value)}
                                className="w-full h-full bg-black/40 text-neon-blue px-4 py-3.5 font-bold text-sm outline-none appearance-none cursor-pointer hover:bg-black/60 transition-colors"
                            >
                                <option value="minimum">{t('config.strictMin')}</option>
                                <option value="average">{t('config.strictAvg')}</option>
                                <option value="hard">{t('config.strictHard')}</option>
                            </select>
                            <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-neon-blue/50">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading || !config || isFetching}
                            className={`px-5 py-3.5 font-black text-xs transition-all flex flex-col items-center justify-center leading-tight border-l border-neon-blue/30
                                ${isLoading || !config ? 'bg-white/[0.03] text-gray-600 cursor-not-allowed' : 'text-black bg-neon-blue hover:bg-cyan-400 active:scale-[0.98]'}`}
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
        </div>
    );
}
