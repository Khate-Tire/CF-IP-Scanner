import React, { useState, useEffect } from 'react';
import ConfigInput from './components/ConfigInput';
import ResultsTable from './components/ResultsTable';
import LogBox from './components/LogBox';
import StatsPanel from './components/StatsPanel';
import { scanIPs, getScanStatus } from './api';

function App() {
  const [scanId, setScanId] = useState(null);
  const [results, setResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState(null);
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    import('./api').then(api => {
      api.getMyIP().then(info => {
        if (info) setUserInfo(info);
      });
    });
  }, []);

  const handleStartScan = async (vlessConfig, manualIps, settings) => {
    setIsScanning(true);
    setResults([]);
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
        ip_version: settings.ipVersion
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
            if (data.status.status === 'completed') {
              setIsScanning(false);
              clearInterval(interval);
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [scanId, isScanning]);

  return (
    <div className="min-h-screen p-8 bg-[url('/bg-grid.svg')] bg-cover">
      <div className="max-w-4xl mx-auto relative z-10">
        <header className="text-center mb-10">
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-purple drop-shadow-[0_0_10px_rgba(188,19,254,0.5)]">
            ANTIGRAVITY IP SCANNER
          </h1>
          <p className="text-gray-400 mt-2 tracking-widest uppercase text-sm">
            Cloudflare IP Optimization Tool
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
        </header>

        <ConfigInput onStartScan={handleStartScan} isLoading={isScanning} />

        {isScanning && status && (
          <div className="mt-4 text-center text-neon-blue animate-pulse mb-6">
            Scanning... {status.completed} / {status.total} IPs checked
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

        <ResultsTable results={results} />
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
