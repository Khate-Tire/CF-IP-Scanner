/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import { dnsStartScan, dnsGetScanStatus, dnsStopScan, dnsQuickTest, dnsBestConfig, dnsGetResolvers, dnsExportScan, dnsRetestTop, dnsGetHistory, dnsGenerateConfig, dnsPredictBest } from '../api';

const COUNTRIES = [
  { id: 'global', label: '🌍 Global', flag: '🌍' },
  { id: 'iran', label: '🇮🇷 Iran', flag: '🇮🇷' },
  { id: 'china', label: '🇨🇳 China', flag: '🇨🇳' },
  { id: 'russia', label: '🇷🇺 Russia', flag: '🇷🇺' },
  { id: 'turkey', label: '🇹🇷 Turkey', flag: '🇹🇷' },
  { id: 'uae', label: '🇦🇪 UAE', flag: '🇦🇪' },
  { id: 'saudi', label: '🇸🇦 Saudi', flag: '🇸🇦' },
  { id: 'egypt', label: '🇪🇬 Egypt', flag: '🇪🇬' },
  { id: 'pakistan', label: '🇵🇰 Pakistan', flag: '🇵🇰' },
  { id: 'india', label: '🇮🇳 India', flag: '🇮🇳' },
  { id: 'brazil', label: '🇧🇷 Brazil', flag: '🇧🇷' },
  { id: 'indonesia', label: '🇮🇩 Indonesia', flag: '🇮🇩' },
];

function ScoreBadge({ score }) {
  const color = score >= 5 ? 'emerald' : score >= 3 ? 'yellow' : 'red';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold bg-${color}-500/20 text-${color}-400 border border-${color}-500/30`}>
      {score}/6
    </span>
  );
}

export default function DnsOptimizer({ onSendToAdvanced }) {
  const { t } = useTranslation();
  const [domain, setDomain] = useState('');
  const [selectedCountries, setSelectedCountries] = useState(['global']);
  const [customResolvers, setCustomResolvers] = useState('');
  const [concurrency, setConcurrency] = useState(20);
  
  const [scanId, setScanId] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanData, setScanData] = useState(null);
  
  const [bestConfig, setBestConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [prediction, setPrediction] = useState(null);

  // Advanced Protocol Settings
  const [protocol, setProtocol] = useState('udp');
  const [doPayloadTest, setDoPayloadTest] = useState(false);
  const [frontingDomain, setFrontingDomain] = useState('');
  
  // Sorting & Filtering
  const [sortConfig, setSortConfig] = useState({ key: 'score', dir: 'desc' });
  const [filterMinScore, setFilterMinScore] = useState(0);
  const [filterMaxLat, setFilterMaxLat] = useState(10000);
  const [filterEdns, setFilterEdns] = useState(false);

  // Poll scan status
  useEffect(() => {
    if (!scanId || !scanning) return;
    const iv = setInterval(async () => {
      try {
        const d = await dnsGetScanStatus(scanId);
        setScanData(d);
        if (d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled') {
          setScanning(false);
          loadHistory();
          if (d.status === 'completed' && domain) {
            try { const bc = await dnsBestConfig(scanId, domain); setBestConfig(bc); } catch(e) {}
          }
        }
      } catch(e) {}
    }, 1000);
    return () => clearInterval(iv);
  }, [scanId, scanning, domain]);

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    try { const h = await dnsGetHistory(); setHistory(h); } catch(e) {}
  };

  const handlePredictBest = async () => {
    try {
      const p = await dnsPredictBest();
      if (p.predicted) setPrediction(p);
      else alert(p.error || "Not enough data");
    } catch(e) {}
  };

  const startScan = async () => {
    setScanning(true); setScanData(null); setBestConfig(null);
    const resolverList = customResolvers ? customResolvers.split(/[\n,\s]+/).filter(Boolean) : null;
    try {
      const r = await dnsStartScan({
        resolvers: resolverList,
        domain: domain || 'example.com',
        countries: selectedCountries,
        concurrency,
        timeout_ms: 5000,
        protocol,
        do_payload_test: doPayloadTest,
        fronting_domain: frontingDomain || undefined
      });
      if (r.scan_id) setScanId(r.scan_id);
      else setScanning(false);
    } catch(e) { setScanning(false); }
  };

  const handleRetestTop = async () => {
    if(!scanId || scanning) return;
    setScanning(true);
    try {
      await dnsRetestTop(scanId, 10, 10);
      const d = await dnsGetScanStatus(scanId);
      setScanData(d);
      if(domain) {
        const bc = await dnsBestConfig(scanId, domain);
        setBestConfig(bc);
      }
    } catch(e) {}
    setScanning(false);
  };

  const handleExport = async (fmt) => {
    if(!scanId) return;
    try {
      if(fmt === 'csv') {
        const csv = await dnsExportScan(scanId, 'csv');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `dns_scan_${scanId}.csv`; a.click();
      } else {
        const js = await dnsExportScan(scanId, 'json');
        const blob = new Blob([JSON.stringify(js, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `dns_scan_${scanId}.json`; a.click();
      }
    } catch(e) {}
  };

  const toggleCountry = (id) => {
    setSelectedCountries(prev => prev.includes(id) ? prev.filter(c=>c!==id) : [...prev, id]);
  };

  const requestSort = (key) => {
    setSortConfig(p => ({ key, dir: p.key === key && p.dir === 'asc' ? 'desc' : 'asc' }));
  };

  const getFilteredSorted = () => {
    if (!scanData || !scanData.results) return [];
    let filtered = scanData.results.filter(r => 
      r.score >= filterMinScore && 
      (r.latency_ms || 9999) <= filterMaxLat &&
      (!filterEdns || r.edns_support)
    );
    filtered.sort((a, b) => {
      let va = a[sortConfig.key] || 0;
      let vb = b[sortConfig.key] || 0;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return filtered;
  };

  const ic = "w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none font-mono transition-all";

  return (
    <div className="glass-panel p-6 neon-border relative overflow-hidden">
      <div className="absolute top-0 left-0 w-64 h-64 bg-violet-500/5 rounded-full blur-[100px] pointer-events-none"/>
      
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center border border-violet-500/30 shadow-[0_0_15px_rgba(139,92,246,0.3)]">
            <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-purple-300">{t('dnsTunnel.optimizerTitle','DNS Optimizer')}</h2>
            <p className="text-sm text-gray-400">{t('dnsTunnel.optimizerSubtitle','Find the fastest DNS resolvers for your tunnel')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePredictBest} className="px-4 py-2 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 hover:from-indigo-500/40 hover:to-purple-500/40 rounded-lg text-sm font-bold text-indigo-300 transition-colors border border-indigo-500/30">
            ✨ AI Predict
          </button>
          <button onClick={() => setShowHistory(!showHistory)} className="px-4 py-2 bg-gray-800/50 hover:bg-gray-800 rounded-lg text-sm font-bold text-gray-300 transition-colors border border-gray-700">
            🕒 {t('dnsTunnel.history','History')}
          </button>
        </div>
      </div>

      {prediction && (
        <div className="mb-6 p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/30 flex items-center justify-between">
          <div>
            <h3 className="text-indigo-400 font-bold flex items-center gap-2">✨ AI Prediction</h3>
            <p className="text-gray-300 text-sm mt-1">Based on historical data, the best resolver for this network is <strong className="text-white font-mono">{prediction.resolver}</strong> (Est. Latency: {prediction.avg_latency}ms)</p>
          </div>
          <button onClick={() => {setCustomResolvers(prediction.resolver); setPrediction(null);}} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-bold transition-colors">
            Use This
          </button>
        </div>
      )}

      {showHistory && (
        <div className="mb-6 p-4 bg-black/40 rounded-xl border border-gray-700 max-h-60 overflow-y-auto">
          <h3 className="text-white font-bold mb-3">{t('dnsTunnel.scanHistory','Scan History')}</h3>
          {history.length === 0 ? <p className="text-gray-500 text-sm">No history yet.</p> : (
            <div className="space-y-2">
              {history.map((h, i) => (
                <div key={i} className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/50 text-sm cursor-pointer hover:bg-gray-800/50" onClick={()=>{setScanId(h.scan_id); setScanData(null); setShowHistory(false);}}>
                  <div>
                    <p className="text-white font-bold">{h.domain || 'example.com'}</p>
                    <p className="text-gray-400 text-xs">{new Date(h.timestamp).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-emerald-400 font-mono">{h.best_resolver || 'N/A'}</p>
                    <p className="text-gray-400 text-xs">Best: {h.best_score}/6 | Avg: {h.avg_latency}ms</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.tunnelDomain','Tunnel Domain')}</label>
            <input className={ic} value={domain} onChange={e=>setDomain(e.target.value)} placeholder="t.example.com"/>
          </div>
          <div>
            <label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.concurrency','Concurrency')} ({concurrency})</label>
            <div className="h-[42px] flex items-center px-4 bg-[#0d0d12] border border-gray-700 rounded-lg">
              <input type="range" min="5" max="50" value={concurrency} onChange={e=>setConcurrency(+e.target.value)} className="w-full accent-violet-500"/>
            </div>
          </div>
        </div>

        <div className="bg-black/30 p-4 rounded-xl border border-gray-800 space-y-4">
          <h4 className="text-gray-300 font-bold text-sm">Advanced Protocol Settings</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-gray-400 text-xs font-bold uppercase mb-2">Transport Protocol</label>
              <select value={protocol} onChange={e=>setProtocol(e.target.value)} className="w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none transition-all">
                <option value="udp">UDP (Standard)</option>
                <option value="tcp">TCP</option>
                <option value="tls">DoT (DNS over TLS)</option>
                <option value="https">DoH (DNS over HTTPS)</option>
                <option value="quic">DoQ (DNS over QUIC)</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-bold uppercase mb-2">Domain Fronting (DoH)</label>
              <input value={frontingDomain} onChange={e=>setFrontingDomain(e.target.value)} placeholder="cdn.example.com" disabled={protocol !== 'https'} className="w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none transition-all disabled:opacity-50"/>
            </div>
            <div className="flex items-center mt-6">
              <label className="flex items-center gap-2 cursor-pointer text-gray-300 text-sm">
                <input type="checkbox" checked={doPayloadTest} onChange={e=>setDoPayloadTest(e.target.checked)} className="rounded border-gray-700 text-violet-500 focus:ring-violet-500 bg-[#0d0d12] w-4 h-4"/>
                Test Max Payload (TXT/NULL)
              </label>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-gray-400 text-xs font-bold uppercase mb-2">{t('dnsTunnel.scanRegions','Scan Regions')}</label>
          <div className="flex flex-wrap gap-2">
            {COUNTRIES.map(c => (
              <button key={c.id} onClick={()=>toggleCountry(c.id)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center gap-1 ${selectedCountries.includes(c.id)?'bg-violet-500/20 border-violet-500 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.2)]':'bg-black/40 border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.customResolvers','Custom Resolvers (optional)')}</label>
          <textarea className={ic+" h-16 resize-none"} value={customResolvers} onChange={e=>setCustomResolvers(e.target.value)} placeholder="8.8.8.8&#10;1.1.1.1"/>
        </div>

        <button onClick={scanning ? ()=>dnsStopScan(scanId) : startScan}
          className={`w-full py-3 rounded-xl font-bold transition-all ${scanning?'bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30':'bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:from-violet-400 hover:to-purple-400 shadow-[0_0_20px_rgba(139,92,246,0.4)]'}`}>
          {scanning ? '⏹ '+t('dnsTunnel.stopScan','Stop Scan') : '🔍 '+t('dnsTunnel.startScan','Start DNS Scan')}
        </button>

        {scanData && (
          <div className="space-y-4 animate-in fade-in">
            {/* Live Stats */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-black/40 border border-gray-800 p-3 rounded-lg text-center">
                <p className="text-gray-400 text-xs font-bold mb-1">Progress</p>
                <p className="text-white text-lg font-bold">{scanData.completed}/{scanData.total}</p>
              </div>
              <div className="bg-black/40 border border-gray-800 p-3 rounded-lg text-center">
                <p className="text-gray-400 text-xs font-bold mb-1">Avg Latency</p>
                <p className="text-white text-lg font-bold">{scanData.stats?.avg_latency || 0}ms</p>
              </div>
              <div className="bg-black/40 border border-gray-800 p-3 rounded-lg text-center">
                <p className="text-gray-400 text-xs font-bold mb-1">Pass Rate</p>
                <p className="text-emerald-400 text-lg font-bold">{scanData.stats?.pass_rate || 0}%</p>
              </div>
              <div className="bg-black/40 border border-gray-800 p-3 rounded-lg text-center">
                <p className="text-gray-400 text-xs font-bold mb-1">Status</p>
                <p className={`text-lg font-bold capitalize ${scanData.status==='completed'?'text-emerald-400':scanData.status==='running'?'text-violet-400 animate-pulse':'text-red-400'}`}>{scanData.status}</p>
              </div>
            </div>

            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-purple-400 transition-all duration-300 rounded-full" style={{width:`${scanData.total?Math.round(scanData.completed/scanData.total*100):0}%`}}/>
            </div>

            {scanData.status === 'completed' && scanData.results?.length > 0 && (
              <div className="flex gap-2">
                <button onClick={handleRetestTop} className="flex-1 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-bold hover:bg-blue-500/30 transition-colors">
                  🔄 Refine Top 10
                </button>
                <button onClick={()=>handleExport('json')} className="flex-1 py-2 bg-gray-800 text-gray-300 border border-gray-700 rounded-lg text-sm font-bold hover:bg-gray-700 transition-colors">
                  💾 Export JSON
                </button>
                <button onClick={()=>handleExport('csv')} className="flex-1 py-2 bg-gray-800 text-gray-300 border border-gray-700 rounded-lg text-sm font-bold hover:bg-gray-700 transition-colors">
                  📄 Export CSV
                </button>
                <button onClick={() => {
                  if (scanData && scanData.results) {
                    const top10 = getFilteredSorted().slice(0, 10).map(r => r.resolver).join('\n');
                    navigator.clipboard.writeText(top10).then(() => alert('Top 10 resolvers copied to clipboard!'));
                  }
                }} className="flex-1 py-2 bg-gray-800 text-gray-300 border border-gray-700 rounded-lg text-sm font-bold hover:bg-gray-700 transition-colors">
                  📋 Copy Top 10
                </button>
              </div>
            )}

            {/* Best Config & Charts */}
            {bestConfig && bestConfig.best_resolver && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/30">
                  <h3 className="text-emerald-400 font-bold mb-3 flex items-center gap-2">🏆 Best Configuration</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center bg-black/40 p-2 rounded border border-emerald-500/20">
                      <span className="text-gray-400 text-xs">Resolver</span>
                      <span className="text-white font-mono font-bold text-lg">{bestConfig.best_resolver}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-black/40 p-2 rounded border border-gray-800 text-center">
                        <span className="block text-gray-400 text-[10px] uppercase">Score</span>
                        <ScoreBadge score={bestConfig.best_score}/>
                      </div>
                      <div className="bg-black/40 p-2 rounded border border-gray-800 text-center">
                        <span className="block text-gray-400 text-[10px] uppercase">Latency</span>
                        <span className="text-white font-bold">{bestConfig.best_latency}ms</span>
                      </div>
                      <div className="bg-black/40 p-2 rounded border border-gray-800 text-center">
                        <span className="block text-gray-400 text-[10px] uppercase">Est. Speed</span>
                        <span className="text-white font-bold">{bestConfig.best_throughput ? bestConfig.best_throughput+' Mbps' : '—'}</span>
                      </div>
                    </div>
                    
                    <div className="bg-black/40 p-3 rounded border border-gray-800">
                      <span className="text-gray-400 text-xs mb-1 block">Generated Config ({bestConfig.recommendation.tunnel_type.toUpperCase()})</span>
                      <div className="relative">
                        <code className="text-xs text-emerald-300 break-all font-mono">
                          {bestConfig.configs?.slipnet_uri || bestConfig.configs?.dnstt?.cmd}
                        </code>
                      </div>
                    </div>

                    {bestConfig.recommendation?.notes?.length > 0 && (
                      <div className="space-y-1">
                        {bestConfig.recommendation.notes.map((n,i)=><p key={i} className="text-xs text-yellow-400 flex items-center gap-1">⚠️ {n}</p>)}
                      </div>
                    )}
                    {onSendToAdvanced && (
                      <button
                        type="button"
                        onClick={() => onSendToAdvanced({
                          mode: 'dns_tunnel',
                          dnsTestMode: 'dnstt',
                          nameservers: bestConfig.best_resolver,
                          dnsDomain: domain,
                        })}
                        className="w-full py-2.5 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 hover:from-emerald-500/40 hover:to-teal-500/40 border border-emerald-500/40 text-emerald-400 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                      >
                        🚀 Test in Advanced Scanners
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-black/40 border border-gray-800 flex flex-col justify-center space-y-4">
                  <h3 className="text-white font-bold text-sm">Latency Distribution</h3>
                  <div className="flex gap-2 items-end h-24">
                    {scanData.stats?.latency_buckets && Object.entries(scanData.stats.latency_buckets).map(([lbl, count]) => {
                      const max = Math.max(...Object.values(scanData.stats.latency_buckets)) || 1;
                      const h = Math.max(5, (count / max) * 100);
                      return (
                        <div key={lbl} className="flex-1 flex flex-col items-center gap-1 group relative">
                          <div className="w-full bg-violet-500/50 rounded-t transition-all hover:bg-violet-400" style={{height: `${h}%`}}/>
                          <span className="text-[9px] text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis w-full text-center">{lbl}</span>
                          <div className="absolute -top-6 bg-black text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-gray-700 shadow-lg">
                            {count} resolvers
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  <h3 className="text-white font-bold text-sm mt-4">Score Distribution</h3>
                  <div className="flex gap-2 text-center text-xs">
                    <div className="flex-1 bg-emerald-500/10 border border-emerald-500/20 rounded p-2 text-emerald-400">
                      <span className="block font-bold text-lg">{scanData.stats?.excellent || 0}</span>
                      Excellent (5-6)
                    </div>
                    <div className="flex-1 bg-yellow-500/10 border border-yellow-500/20 rounded p-2 text-yellow-400">
                      <span className="block font-bold text-lg">{scanData.stats?.good || 0}</span>
                      Good (3-4)
                    </div>
                    <div className="flex-1 bg-red-500/10 border border-red-500/20 rounded p-2 text-red-400">
                      <span className="block font-bold text-lg">{scanData.stats?.poor || 0}</span>
                      Poor (0-2)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Results Table Filters */}
            <div className="flex flex-wrap gap-3 items-center bg-black/40 p-3 rounded-lg border border-gray-800">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-xs">Min Score:</span>
                <select value={filterMinScore} onChange={e=>setFilterMinScore(+e.target.value)} className="bg-[#0d0d12] text-white border border-gray-700 rounded px-2 py-1 text-xs">
                  <option value={0}>Any</option>
                  <option value={3}>3+</option>
                  <option value={4}>4+</option>
                  <option value={5}>5+</option>
                  <option value={6}>6 (Perfect)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-xs">Max Latency:</span>
                <select value={filterMaxLat} onChange={e=>setFilterMaxLat(+e.target.value)} className="bg-[#0d0d12] text-white border border-gray-700 rounded px-2 py-1 text-xs">
                  <option value={10000}>Any</option>
                  <option value={100}>100ms</option>
                  <option value={200}>200ms</option>
                  <option value={500}>500ms</option>
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-gray-300 text-xs">
                <input type="checkbox" checked={filterEdns} onChange={e=>setFilterEdns(e.target.checked)} className="rounded border-gray-700 text-violet-500 focus:ring-violet-500 bg-[#0d0d12]"/>
                EDNS Support Only
              </label>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full text-xs">
                <thead><tr className="bg-black/60 text-gray-400">
                  <th className="px-3 py-3 text-left cursor-pointer hover:text-white" onClick={()=>requestSort('resolver')}>
                    Resolver {sortConfig.key==='resolver' && (sortConfig.dir==='asc'?'↑':'↓')}
                  </th>
                  <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={()=>requestSort('score')}>
                    Score {sortConfig.key==='score' && (sortConfig.dir==='asc'?'↑':'↓')}
                  </th>
                  <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={()=>requestSort('latency_ms')}>
                    Latency {sortConfig.key==='latency_ms' && (sortConfig.dir==='asc'?'↑':'↓')}
                  </th>
                  <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={()=>requestSort('throughput_est')}>
                    Est. Mbps {sortConfig.key==='throughput_est' && (sortConfig.dir==='asc'?'↑':'↓')}
                  </th>
                  <th className="px-3 py-3 text-center">EDNS</th>
                  {doPayloadTest && <th className="px-3 py-3 text-center">TXT/NULL</th>}
                  <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={()=>requestSort('nxdomain_hijack')}>
                    Hijack {sortConfig.key==='nxdomain_hijack' && (sortConfig.dir==='asc'?'↑':'↓')}
                  </th>
                  <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={()=>requestSort('country')}>
                    Region {sortConfig.key==='country' && (sortConfig.dir==='asc'?'↑':'↓')}
                  </th>
                </tr></thead>
                <tbody>
                  {getFilteredSorted().slice(0, 100).map((r, i) => (
                    <tr key={i} className={`border-t border-gray-800/50 ${r.score>=5?'bg-emerald-500/5':r.score>=3?'bg-yellow-500/5':'bg-red-500/5'} hover:bg-white/5 transition-colors`}>
                      <td className="px-3 py-2 font-mono text-white flex items-center gap-2">
                        {r.resolver}
                        {r.jitter !== undefined && <span className="text-[9px] text-gray-500 bg-black/40 px-1 rounded border border-gray-800">±{r.jitter}ms</span>}
                      </td>
                      <td className="px-3 py-2 text-center"><ScoreBadge score={r.score}/></td>
                      <td className="px-3 py-2 text-center text-gray-300">{r.latency_ms ? r.latency_ms+'ms' : '—'}</td>
                      <td className="px-3 py-2 text-center font-bold text-violet-300">{r.throughput_est ? r.throughput_est : '—'}</td>
                      <td className="px-3 py-2 text-center">{r.edns_support?'✅':'❌'}</td>
                      {doPayloadTest && <td className="px-3 py-2 text-center text-[10px]">{r.txt_support?'✅':'❌'} / {r.null_support?'✅':'❌'}</td>}
                      <td className="px-3 py-2 text-center">{r.nxdomain_hijack?'⚠️':'✅'}</td>
                      <td className="px-3 py-2 text-center text-gray-400 capitalize">{r.country||'—'}</td>
                    </tr>
                  ))}
                  {getFilteredSorted().length === 0 && (
                    <tr><td colSpan="7" className="text-center py-8 text-gray-500">No results match your filters.</td></tr>
                  )}
                </tbody>
              </table>
              {getFilteredSorted().length > 100 && (
                <div className="p-2 text-center text-xs text-gray-500 bg-black/40">
                  Showing top 100 of {getFilteredSorted().length} results. Use export for full data.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
