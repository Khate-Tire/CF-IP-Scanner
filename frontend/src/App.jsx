import React, { useState, useEffect, useRef } from 'react';
import ConfigInput from './components/ConfigInput';
import ResultsTable from './components/ResultsTable';
import LogBox from './components/LogBox';
import StatsPanel from './components/StatsPanel';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import AdvancedScanners from './components/AdvancedScanners';
import WarpScanner from './components/WarpScanner';
import AboutBox from './components/AboutBox';
import HealthWidget from './components/HealthWidget';
import UpdateModal from './components/UpdateModal';
import FragmentChart from './components/FragmentChart';
import IranLogo from './components/IranLogo';
import LanguageSwitcher from './components/LanguageSwitcher';
import { useTranslation } from './i18n/LanguageContext';
import { scanIPs, getScanStatus, logUsage, scanAdvancedIPs, pauseScan, resumeScan, stopScan } from './api';

function App() {
  const [scanId, setScanId] = useState(null);
  const [results, setResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('scanner');

  // Use Refs for Scan State to prevent massive re-renders during active polling
  const currentVlessConfig = useRef("");
  const currentScanSettings = useRef(null);
  const currentManualIps = useRef("");
  const retryCount = useRef(0);

  const [useSystemProxy, setUseSystemProxy] = useState(false);
  const isInitialMount = useRef(true);

  useEffect(() => {
    import('./api').then(api => {
      api.getMyIP(useSystemProxy).then(info => {
        if (info) {
          setUserInfo(info);
          if (isInitialMount.current) {
            logUsage("app_open", "User opened the application");
            isInitialMount.current = false;
          }
        }
      });
    });
  }, [useSystemProxy]);

  const handleStartScan = async (vlessConfig, manualIps, settings, isRetry = false) => {
    setIsScanning(true);
    if (!isRetry) {
      setResults([]);
      retryCount.current = 0;
    }
    currentVlessConfig.current = vlessConfig;
    currentScanSettings.current = settings;
    currentManualIps.current = manualIps;
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
      if (res.scan_id) {
        setScanId(res.scan_id);
      } else {
        alert("Error starting scan: " + JSON.stringify(res));
        setIsScanning(false);
      }
    } catch (e) {
      alert("Error: " + e.message);
      setIsScanning(false);
    }
  };

  const handleStartAdvanced = async (payload) => {
    setIsScanning(true);
    setResults([]);
    try {
      const res = await scanAdvancedIPs({ ...payload, use_system_proxy: useSystemProxy });
      if (res.scan_id) {
        setScanId(res.scan_id);
      } else {
        alert("Error starting advanced scan: " + JSON.stringify(res));
        setIsScanning(false);
      }
    } catch (e) {
      alert("Error: " + e.message);
      setIsScanning(false);
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
      <HealthWidget />
      <UpdateModal />
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
                src="/logo.png"
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
          </div>
        </header>

        <div className="flex justify-center gap-4 mb-8">
          <button
            onClick={() => setActiveTab('scanner')}
            className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === 'scanner' ? 'bg-neon-blue text-black shadow-[0_0_15px_rgba(0,243,255,0.8)]' : 'bg-white/5 text-gray-400 hover:text-white'}`}
          >
            {t('app.tabs.scanner')}
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === 'analytics' ? 'bg-neon-purple text-black shadow-[0_0_15px_rgba(188,19,254,0.8)]' : 'bg-white/5 text-gray-400 hover:text-white'}`}
          >
            {t('app.tabs.analytics')}
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === 'advanced' ? 'bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.8)]' : 'bg-white/5 text-gray-400 hover:text-white'}`}
          >
            {t('app.tabs.advanced')}
          </button>
          <button
            onClick={() => setActiveTab('warp')}
            className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === 'warp' ? 'bg-orange-500 text-black shadow-[0_0_15px_rgba(249,115,22,0.8)]' : 'bg-white/5 text-gray-400 hover:text-white'}`}
          >
            {t('app.tabs.warp')}
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === 'about' ? 'bg-green-500 text-black shadow-[0_0_15px_rgba(34,197,94,0.8)]' : 'bg-white/5 text-gray-400 hover:text-white'}`}
          >
            {t('app.tabs.about')}
          </button>
        </div>

        {activeTab === 'scanner' ? (
          <>
            <ConfigInput onStartScan={handleStartScan} isLoading={isScanning} useSystemProxy={useSystemProxy} />

            {isScanning && status && (
              <div className="mt-4 flex flex-col items-center justify-center gap-3 mb-6">
                <div className="text-center text-neon-blue font-bold">
                  {retryCount > 0 && <span className="text-yellow-400 block mb-2">⚠️ Strict Limits Failed. Relaxing Thresholds (Attempt {retryCount}/2)...</span>}
                  <span className={status.status === 'running' ? "animate-pulse" : ""}>
                    {status.status === 'paused' ? 'Paused...' : 'Scanning...'} {status.completed} / {status.total} IPs checked
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

            <ResultsTable results={results} vlessConfig={currentVlessConfig} />
          </>
        ) : activeTab === 'advanced' ? (
          <>
            <AdvancedScanners onStartAdvanced={handleStartAdvanced} isLoading={isScanning} />

            {isScanning && status && (
              <div className="mt-4 text-center text-white animate-pulse mb-6">
                Testing bypass variations... {status.completed} / {status.total} checks complete
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

            <ResultsTable results={results} vlessConfig={currentVlessConfig} />
          </>
        ) : activeTab === 'analytics' ? (
          <AnalyticsDashboard />
        ) : activeTab === 'warp' ? (
          <WarpScanner />
        ) : (
          <AboutBox />
        )}
      </div>

      {/* Background ambient glow */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[20%] w-96 h-96 bg-neon-purple/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[20%] w-96 h-96 bg-neon-blue/20 rounded-full blur-[100px]" />
      </div>
    </div>
  );
}

export default App;
