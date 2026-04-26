/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import ConfigInput from './components/ConfigInput';
import ResultsTable from './components/ResultsTable';
import LogBox from './components/LogBox';
import StatsPanel from './components/StatsPanel';
import AdvancedScanners from './components/AdvancedScanners';
import WarpScanner from './components/WarpScanner';
import AboutBox from './components/AboutBox';
import HealthWidget from './components/HealthWidget';
import UpdateModal from './components/UpdateModal';
import DebugConsole from './components/DebugConsole';
import FragmentChart from './components/FragmentChart';
import DnsScanner from './components/DnsScanner';
import DnsScannerGuide from './components/DnsScannerGuide';
import FreeVpnDashboard from './components/FreeVpnDashboard';
import SmartRecommendationPanel from './components/SmartRecommendationPanel';
import DnsTunnelTab from './components/DnsTunnelTab';
import FreedomWidget from './components/FreedomWidget';
import IranLogo from './components/IranLogo';
import DBStatusBar from './components/DBStatusBar';
import LanguageSwitcher from './components/LanguageSwitcher';
import { useTranslation } from './i18n/LanguageContext';
import { Toaster, toast } from 'react-hot-toast';
import logoImg from '/logo.png';
import { scanIPs, getScanStatus, logUsage, scanAdvancedIPs, pauseScan, resumeScan, stopScan, getMyIP, startFreedom, stopFreedom } from './api';
import { API_URL } from './api';

// Heavy tabs are lazy-loaded to cut initial bundle size (~30%)
const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));
const DataTransferPanel = lazy(() => import('./components/DataTransferPanel'));

const TabFallback = () => (
  <div className="flex items-center justify-center h-64 text-neon-blue animate-pulse">
    <svg className="w-8 h-8 animate-spin mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
    Loading...
  </div>
);

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

function App() {
  const [scanId, setScanId] = useState(null);
  const [results, setResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [status, setStatus] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('scanner');
  const [autoStartSignal, setAutoStartSignal] = useState(0);
  const [backendReady, setBackendReady] = useState(false);
  const [advancedPreset, setAdvancedPreset] = useState(null);
  const [scannerPreset, setScannerPreset] = useState(null);
  const [scanOriginTab, setScanOriginTab] = useState(null); // which tab launched the active scan

  const handleSendToAdvancedScanner = (preset) => {
    setAdvancedPreset(preset);
    setActiveTab('advanced');
  };

  const handleSendToScanner = (preset) => {
    setScannerPreset(preset);
    setActiveTab('scanner');
    toast.success('Filter applied — review settings and click Start Scan');
  };

  // Use Refs for Scan State to prevent massive re-renders during active polling
  const currentVlessConfig = useRef("");
  const currentScanSettings = useRef(null);
  const currentManualIps = useRef("");
  const retryCount = useRef(0);

  const [useSystemProxy, setUseSystemProxy] = useState(false);
  const isInitialMount = useRef(true);
  const [latestVersion, setLatestVersion] = useState(null);
  const [updateUrl, setUpdateUrl] = useState(null);

  // Poll backend liveness until it's ready (max 60 retries = ~60s, then surface error).
  // We hit /ping (zero I/O) instead of /health (which does network checks) so a
  // blocked ISP never delays the splash.
  const [bootElapsed, setBootElapsed] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const checkBackend = async () => {
      const startedAt = Date.now();
      let attempts = 0;
      while (!cancelled && attempts < 60) {
        try {
          const res = await fetch(`${API_URL}/ping`, { signal: AbortSignal.timeout(1500) });
          if (res.ok) { setBackendReady(true); return; }
        } catch (e) { /* backend not ready yet */ }
        attempts++;
        setBootElapsed(Math.floor((Date.now() - startedAt) / 1000));
        await new Promise(r => setTimeout(r, 500));
      }
      if (!cancelled) {
        toast.error('Backend failed to start after 60s. Please restart the application.');
      }
    };
    checkBackend();
    // Also listen for Electron IPC signal (via secure preload bridge)
    let unsubscribeBackendReady = null;
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onBackendReady) {
      try {
        unsubscribeBackendReady = window.electronAPI.onBackendReady(() => setBackendReady(true));
      } catch (e) { /* not in Electron */ }
    }
    return () => {
      cancelled = true;
      if (unsubscribeBackendReady) { try { unsubscribeBackendReady(); } catch (_) { /* noop */ } }
    };
  }, []);

  useEffect(() => {
    getMyIP(useSystemProxy).then(info => {
      if (info) {
        setUserInfo(info);
        if (isInitialMount.current) {
          logUsage("app_open", "User opened the application");
          isInitialMount.current = false;
        }
      }
    });
  }, [useSystemProxy]);

  // GitHub Release Version Check — only show update if remote is NEWER and user hasn't dismissed it
  useEffect(() => {
    fetch('https://api.github.com/repos/Khate-Tire/CF-IP-Scanner/releases/latest')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.tag_name) {
          const remote = data.tag_name.replace(/^v/, '');
          const dismissed = localStorage.getItem('dismissed_update_version');
          if (dismissed === remote) return;
          const rParts = remote.split('.').map(Number);
          const lParts = APP_VERSION.split('.').map(Number);
          let isNewer = false;
          for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
            const r = rParts[i] || 0, l = lParts[i] || 0;
            if (r > l) { isNewer = true; break; }
            if (r < l) break;
          }
          if (isNewer) {
            setLatestVersion(remote);
            setUpdateUrl(data.html_url);
          }
        }
      })
      .catch(() => { });
  }, []);

  const dismissUpdate = () => {
    if (latestVersion) localStorage.setItem('dismissed_update_version', latestVersion);
    setLatestVersion(null);
    setUpdateUrl(null);
  };

  const handleStartScan = async (vlessConfig, manualIps, settings, isRetry = false) => {
    setIsScanning(true);
    setScanOriginTab('scanner');
    if (!isRetry) {
      setResults([]);
      retryCount.current = 0;
    }
    currentVlessConfig.current = vlessConfig;
    currentScanSettings.current = settings;
    currentManualIps.current = manualIps;

    let started = false;
    try {
      const res = await scanIPs({
        vless_config: vlessConfig,
        ip_count: 50, // Default for demo
        manual_ips: manualIps,
        stop_after: settings.stopAfter,
        concurrency: settings.concurrency,
        max_ping: settings.maxPing,
        max_jitter: settings.maxJitter,
        min_download: settings.minDown,
        min_upload: settings.minUp,
        ip_version: settings.ipVersion,
        ip_source: settings.ipSource,
        custom_url: settings.customUrl,
        use_system_proxy: useSystemProxy
      });
      if (res && res.scan_id) {
        setScanId(res.scan_id);
        started = true;
      } else {
        toast.error("Error starting scan: " + (res?.error ? res.error : JSON.stringify(res)));
      }
    } catch (e) {
      toast.error("Error: " + e.message);
    } finally {
      if (!started) {
        setIsScanning(false);
      }
    }
  };

  const handleStartAdvanced = async (payload) => {
    setIsScanning(true);
    setScanOriginTab(activeTab); // 'advanced' or 'dns'
    setResults([]);
    let started = false;
    try {
      const res = await scanAdvancedIPs({ ...payload, use_system_proxy: useSystemProxy });
      if (res && res.scan_id) {
        setScanId(res.scan_id);
        started = true;
      } else {
        toast.error("Error starting advanced scan: " + (res?.error ? res.error : JSON.stringify(res)));
      }
    } catch (e) {
      toast.error("Error: " + e.message);
    } finally {
      if (!started) {
        setIsScanning(false);
      }
    }
  };

  useEffect(() => {
    let interval;
    if (scanId && isScanning) {
      interval = setInterval(async () => {
        try {
          const data = await getScanStatus(scanId);
          if (data.results) {
            setResults(data.results);
          }
          if (data.status) {
            setStatus(data.status);
            if (data.status.status === 'completed' || data.status.status === 'stopped') {
              setIsScanning(false);
              clearInterval(interval);

              // Smart Fallback Retry Logic
              const isAutoScan = currentScanSettings.current?.ipSource === 'smart_history' || currentScanSettings.current?.ipSource === 'gold_ips';
              if (data.status.status === 'completed' && data.status.found_good === 0 && isAutoScan && retryCount.current < 2) {
                retryCount.current += 1;

                setIsScanning(true);

                // Relax constraints heavily to bypass censorship
                const relaxedSettings = { ...currentScanSettings.current };
                relaxedSettings.maxPing = Math.min((relaxedSettings.maxPing || 1000) + 1500, 4000);
                relaxedSettings.maxJitter = Math.min((relaxedSettings.maxJitter || 300) + 1000, 2000);
                relaxedSettings.minDown = 0; // completely disable speed limits on retry
                relaxedSettings.minUp = 0;
                currentScanSettings.current = relaxedSettings;

                setTimeout(async () => {
                  try {
                    const res = await scanIPs({
                      vless_config: currentVlessConfig.current,
                      ip_count: 50,
                      manual_ips: currentManualIps.current,
                      stop_after: relaxedSettings.stopAfter,
                      concurrency: relaxedSettings.concurrency,
                      max_ping: relaxedSettings.maxPing,
                      max_jitter: relaxedSettings.maxJitter,
                      min_download: relaxedSettings.minDown,
                      min_upload: relaxedSettings.minUp,
                      ip_version: relaxedSettings.ipVersion,
                      ip_source: relaxedSettings.ipSource,
                      custom_url: relaxedSettings.customUrl,
                      use_system_proxy: useSystemProxy
                    });
                    if (res.scan_id) {
                      setScanId(res.scan_id);
                    } else {
                      setIsScanning(false);
                    }
                  } catch (e) { setIsScanning(false); }
                }, 2000);
              }
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [scanId, isScanning, useSystemProxy]);

  const { t } = useTranslation();

  return (
    <div className="min-h-screen p-8 bg-[url('/bg-grid.svg')] bg-cover relative">
      {!backendReady && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0f172a]">
          <img src={logoImg} alt="Loading" className="w-24 h-24 mb-6 animate-pulse" />
          <div className="flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-cyan-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-cyan-400 font-mono text-sm tracking-wider">{t('app.startingEngine', 'Starting engine...')}</span>
          </div>
          {bootElapsed >= 5 && (
            <div className="mt-6 max-w-md text-center text-xs text-amber-300/80 font-mono leading-relaxed px-4">
              {t('app.startupSlow',
                'Engine is taking longer than usual. If your ISP is blocking the internet the app will still start — give it a moment, or restart it if this persists.')}
            </div>
          )}
        </div>
      )}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#111',
            color: '#fff',
            border: '1px solid #333',
            fontFamily: 'monospace',
            minWidth: '250px'
          },
          success: { iconTheme: { primary: '#39FF14', secondary: '#000' } },
          error: { iconTheme: { primary: '#EF4444', secondary: '#fff' } }
        }}
      />
      <HealthWidget />
      <DBStatusBar />
      <UpdateModal />
      <DebugConsole />
      <div className="max-w-4xl mx-auto relative z-10">
        <header className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <div className="relative group cursor-pointer">
              {/* Outer pulsing neon aura */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-b from-neon-blue/30 via-neon-purple/20 to-neon-blue/30 blur-3xl scale-[2] animate-pulse opacity-60 group-hover:opacity-100 transition-opacity duration-500"></div>
              {/* Orbiting ring */}
              <div className="absolute inset-[-12px] rounded-full border border-neon-blue/20 animate-spin" style={{ animationDuration: '8s' }}></div>
              <div className="absolute inset-[-6px] rounded-full border border-neon-purple/15 animate-spin" style={{ animationDuration: '12s', animationDirection: 'reverse' }}></div>
              {/* Inner glow ring */}
              <div className="absolute inset-[-3px] rounded-full bg-gradient-to-tr from-neon-blue/20 to-neon-purple/20 blur-md"></div>
              {/* The logo */}
              <img
                src={logoImg}
                alt="Antigravity IP Scanner"
                className="relative w-24 h-24 object-contain rounded-full drop-shadow-[0_0_15px_rgba(0,243,255,0.5)] group-hover:scale-110 group-hover:drop-shadow-[0_0_25px_rgba(188,19,254,0.6)] transition-all duration-500"
                style={{ animation: 'float 3s ease-in-out infinite' }}
              />
            </div>
          </div>
          {/* Language Switcher */}
          <div className="absolute top-0 right-0 rtl:right-auto rtl:left-0">
            <LanguageSwitcher />
          </div>
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-purple drop-shadow-[0_0_10px_rgba(188,19,254,0.5)]">
            {t('app.title')}
          </h1>
          <p className="text-gray-400 mt-2 tracking-widest uppercase text-sm">
            {t('app.subtitle')}
          </p>
          {userInfo && (
            <div className="mt-4 inline-flex items-center gap-4 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-gray-400 font-mono animate-in fade-in slide-in-from-top-2">
              <span className="text-neon-blue">{userInfo.ip}</span>
              <span className="text-gray-600">|</span>
              <span className="text-white">{userInfo.location}</span>
              <span className="text-gray-600">|</span>
              <span className="text-neon-purple">{userInfo.isp}</span>
            </div>
          )}
          <div className="mt-4 mb-2 flex justify-center items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" id="systemProxy" checked={useSystemProxy} onChange={e => setUseSystemProxy(e.target.checked)} className="rounded border-gray-700 bg-gray-900 text-neon-blue focus:ring-neon-blue/50 cursor-pointer" />
            <label htmlFor="systemProxy" className="cursor-pointer hover:text-gray-300 transition-colors">{t('app.proxyLabel')}</label>
          </div>

          {/* GitHub Star & Developer Credit */}
          <div className="mt-3 flex flex-col items-center gap-2">
            <a
              href="https://github.com/Khate-Tire/CF-IP-Scanner"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-bold hover:border-yellow-400 hover:text-yellow-300 hover:shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all group"
            >
              <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
              {t('app.supportGithub')}
            </a>
            <p className="text-[10px] text-gray-600 font-mono tracking-wide">
              {t('app.builtBy')} <a href="https://t.me/hossein_shiravani" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-neon-blue transition-colors">@Khate-Tire</a> — {t('app.openSource')}
            </p>
            {/* Version Badge + Update Button */}
            <div className="flex items-center gap-2 mt-1">
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-gray-500 font-mono">v{APP_VERSION}</span>
              {latestVersion && (
                <div className="inline-flex items-center gap-1">
                  <a href={updateUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1 rounded-l-full bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/40 text-green-400 text-[10px] font-bold hover:border-green-400 hover:shadow-[0_0_15px_rgba(34,197,94,0.3)] transition-all animate-pulse">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    {t('app.updateAvailable', 'Update to v{version}').replace('{version}', latestVersion)}
                  </a>
                  <button onClick={dismissUpdate} title="Skip this version" className="px-2 py-1 rounded-r-full bg-green-500/10 border border-l-0 border-green-500/40 text-green-400/70 text-[10px] font-bold hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/40 transition-all">✕</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ── Glassmorphism Navigation Bar ── */}
        <div className="flex justify-center mb-8 px-2">
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-1.5 flex flex-wrap justify-center gap-1 shadow-[0_4px_30px_rgba(0,0,0,0.3)]">

            {/* Scanner */}
            <button
              onClick={() => setActiveTab('scanner')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'scanner' ? 'nav-tab-active text-[#00f3ff] bg-[#00f3ff]/10 shadow-[0_0_20px_rgba(0,243,255,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
              {t('app.tabs.scanner')}
            </button>

            {/* Analytics */}
            <button
              onClick={() => setActiveTab('analytics')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'analytics' ? 'nav-tab-active text-[#bc13fe] bg-[#bc13fe]/10 shadow-[0_0_20px_rgba(188,19,254,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
              {t('app.tabs.analytics')}
            </button>

            {/* Advanced */}
            <button
              onClick={() => setActiveTab('advanced')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'advanced' ? 'nav-tab-active text-white bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.2)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              {t('app.tabs.advanced')}
            </button>

            <div className="w-px bg-white/[0.08] my-1.5"></div>

            {/* WARP */}
            <button
              onClick={() => setActiveTab('warp')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'warp' ? 'nav-tab-active text-orange-400 bg-orange-500/10 shadow-[0_0_20px_rgba(249,115,22,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
              {t('app.tabs.warp')}
            </button>

            {/* Tunnel & DNS */}
            <button
              onClick={() => setActiveTab('dns')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'dns' ? 'nav-tab-active text-indigo-400 bg-indigo-500/10 shadow-[0_0_20px_rgba(99,102,241,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
              {t('app.tabs.dns')}
            </button>

            {/* Free VPN */}
            <button
              onClick={() => setActiveTab('freevpn')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'freevpn' ? 'nav-tab-active text-[#2AABEE] bg-[#2AABEE]/10 shadow-[0_0_20px_rgba(42,171,238,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" /></svg>
              {t('app.tabs.freevpn')}
            </button>

            {/* DNS Tunnel */}
            <button
              onClick={() => setActiveTab('dnstunnel')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'dnstunnel' ? 'nav-tab-active text-emerald-400 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
              {t('app.tabs.dnsTunnel', 'DNS Tunnel')}
            </button>

            <div className="w-px bg-white/[0.08] my-1.5"></div>

            {/* Data Sync */}
            <button
              onClick={() => setActiveTab('data')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'data' ? 'nav-tab-active text-pink-400 bg-pink-500/10 shadow-[0_0_20px_rgba(236,72,153,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path></svg>
              {t('app.tabs.data')}
            </button>

            {/* Play Freedom */}
            <button
              onClick={() => setActiveTab('freedom')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'freedom' ? 'nav-tab-active text-teal-400 bg-teal-500/10 shadow-[0_0_20px_rgba(20,184,166,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              {t('app.tabs.freedom')}
            </button>

            {/* About */}
            <button
              onClick={() => setActiveTab('about')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ${activeTab === 'about' ? 'nav-tab-active text-green-400 bg-green-500/10 shadow-[0_0_20px_rgba(34,197,94,0.3)]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] hover:-translate-y-[1px]'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              {t('app.tabs.about')}
            </button>

          </div>
        </div>

        {activeTab === 'scanner' ? (
          <>
            <ConfigInput onStartScan={handleStartScan} isLoading={isScanning && scanOriginTab === 'scanner'} useSystemProxy={useSystemProxy} autoStartSignal={autoStartSignal} scannerPreset={scannerPreset} onPresetConsumed={() => setScannerPreset(null)} />

            {isScanning && scanOriginTab === 'scanner' && status && (
              <div className="mt-4 flex flex-col items-center justify-center gap-3 mb-6">
                <div className="text-center text-neon-blue font-bold">
                  {retryCount > 0 && <span className="text-yellow-400 block mb-2">{t('scan.retryMsg', { count: retryCount })}</span>}
                  <span className={status.status === 'running' ? "animate-pulse" : ""}>
                    {status.status === 'paused' ? t('scan.paused', 'Paused...') : t('scan.scanning', 'Scanning...')} {status.completed} / {status.total} {t('scan.scanned', 'IPs checked')}
                  </span>
                </div>

                <div className="flex gap-3">
                  {status.status === 'running' && (
                    <button onClick={() => pauseScan(scanId)} className="px-5 py-1.5 bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 rounded-lg text-sm font-bold hover:bg-yellow-500 hover:text-black transition-colors shadow-[0_0_10px_rgba(234,179,8,0.2)] hover:shadow-[0_0_15px_rgba(234,179,8,0.5)]">
                      PAUSE
                    </button>
                  )}
                  {status.status === 'paused' && (
                    <button onClick={() => resumeScan(scanId)} className="px-5 py-1.5 bg-neon-green/20 text-neon-green border border-neon-green/50 rounded-lg text-sm font-bold hover:bg-neon-green hover:text-black transition-colors shadow-[0_0_10px_rgba(57,255,20,0.2)] hover:shadow-[0_0_15px_rgba(57,255,20,0.5)]">
                      RESUME
                    </button>
                  )}
                  <button onClick={() => stopScan(scanId)} className="px-5 py-1.5 bg-red-500/20 text-red-500 border border-red-500/50 rounded-lg text-sm font-bold hover:bg-red-500 hover:text-black transition-colors shadow-[0_0_10px_rgba(239,68,68,0.2)] hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                    STOP
                  </button>
                </div>
              </div>
            )}

            {status && status.stats && (
              <div className="max-w-4xl mx-auto">
                <StatsPanel stats={status.stats} />
              </div>
            )}

            {/* Logs */}
            {status && status.logs && (
              <div className="max-w-4xl mx-auto mt-4">
                <LogBox logs={status.logs} />
              </div>
            )}

            {results.length === 0 && !isScanning && (
              <div className="max-w-6xl mx-auto mt-8">
                <SmartRecommendationPanel />
              </div>
            )}

            {results.length > 0 && <ResultsTable results={results} vlessConfig={currentVlessConfig.current} onSendToAdvanced={handleSendToAdvancedScanner} />}

          </>
        ) : activeTab === 'advanced' ? (
          <>
            <AdvancedScanners onStartAdvanced={handleStartAdvanced} isLoading={isScanning && scanOriginTab === 'advanced'} initialDnsConfig={advancedPreset} onPresetConsumed={() => setAdvancedPreset(null)} />

            {isScanning && scanOriginTab === 'advanced' && status && (
              <div className="mt-4 text-center text-white animate-pulse mb-6">
                {t('advanced.scanningBypass', 'Testing bypass variations...')} {status.completed} / {status.total} {t('advanced.checksComplete', 'checks complete')}
              </div>
            )}

            {status && status.stats && (
              <div className="max-w-4xl mx-auto">
                <StatsPanel stats={status.stats} />
              </div>
            )}

            {results.length > 0 && <FragmentChart results={results} />}

            {status && status.logs && (
              <div className="max-w-4xl mx-auto mt-4">
                <LogBox logs={status.logs} />
              </div>
            )}

            <ResultsTable results={results} vlessConfig={currentVlessConfig.current} onSendToAdvanced={handleSendToAdvancedScanner} />
          </>
        ) : activeTab === 'dns' ? (
          <>
            <DnsScanner onStartAdvanced={handleStartAdvanced} isLoading={isScanning && scanOriginTab === 'dns'} />
            <DnsScannerGuide />

            {isScanning && scanOriginTab === 'dns' && status && (
              <div className="mt-4 text-center text-white animate-pulse mb-6">
                {t('dnsScanner.testingParams', 'Testing DNS/Tunnel parameters...')} {status.completed} / {status.total} {t('advanced.checksComplete', 'checks complete')}
              </div>
            )}

            {status && status.stats && (
              <div className="max-w-4xl mx-auto">
                <StatsPanel stats={status.stats} />
              </div>
            )}

            {status && status.logs && (
              <div className="max-w-4xl mx-auto mt-4">
                <LogBox logs={status.logs} />
              </div>
            )}

            <ResultsTable results={results} vlessConfig={currentVlessConfig.current} onSendToAdvanced={handleSendToAdvancedScanner} />
          </>
        ) : activeTab === 'analytics' ? (
          <Suspense fallback={<TabFallback />}>
            <AnalyticsDashboard onSendToScanner={handleSendToScanner} />
          </Suspense>
        ) : activeTab === 'warp' ? (
          <WarpScanner />
        ) : activeTab === 'freevpn' ? (
          <FreeVpnDashboard onStartContribution={() => {
            setActiveTab('scanner');
            setAutoStartSignal(Date.now());
          }} />
        ) : activeTab === 'dnstunnel' ? (
          <DnsTunnelTab onSendToAdvanced={handleSendToAdvancedScanner} />
        ) : activeTab === 'freedom' ? (
          <FreedomWidget onStart={async () => {
            try { await startFreedom(); } catch (e) { console.error(e); }
          }} onStop={async () => {
            try { await stopFreedom(); } catch (e) { console.error(e); }
          }} onSendToAdvanced={handleSendToAdvancedScanner} />
        ) : activeTab === 'data' ? (
          <Suspense fallback={<TabFallback />}>
            <DataTransferPanel />
          </Suspense>
        ) : (
          <AboutBox />
        )}
      </div>

      {/* Floating sticky STOP button — visible from any tab while a scan is running */}
      {isScanning && status && status.status === 'running' && (
        <button
          onClick={() => stopScan(scanId)}
          className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-red-500/90 text-white border-2 border-red-400 rounded-full text-sm font-black shadow-[0_0_30px_rgba(239,68,68,0.6)] hover:scale-110 hover:bg-red-500 transition-transform flex items-center gap-2 animate-pulse"
          title="Stop scan in progress"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5 5h10v10H5z" /></svg>
          STOP SCAN ({status.completed}/{status.total})
        </button>
      )}

      {/* Background ambient glow */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[20%] w-96 h-96 bg-neon-purple/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[20%] w-96 h-96 bg-neon-blue/20 rounded-full blur-[100px]" />
      </div>
    </div>
  );
}

export default App;
