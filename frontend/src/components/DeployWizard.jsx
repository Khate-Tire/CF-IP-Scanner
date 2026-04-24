/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import { tunnelConnect, tunnelDisconnect, tunnelPreflight, tunnelVerifyDns, tunnelCloudflareDns, tunnelDeploy, tunnelDeployStatus, tunnelDeployCancel, tunnelGetConfigs } from '../api';

const STEPS = ['connect','preflight','domain','configure','deploy','results'];

function StepIndicator({ current, steps }) {
  return (
    <div className="flex items-center justify-center gap-1 mb-8">
      {steps.map((s,i) => (
        <React.Fragment key={s}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-500 ${i < current ? 'bg-emerald-500 border-emerald-500 text-black' : i === current ? 'border-emerald-400 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'border-gray-700 text-gray-600'}`}>
            {i < current ? '✓' : i+1}
          </div>
          {i < steps.length-1 && <div className={`w-8 h-0.5 transition-all ${i < current ? 'bg-emerald-500' : 'bg-gray-700'}`}/>}
        </React.Fragment>
      ))}
    </div>
  );
}

// Persist non-sensitive form fields so user doesn't re-type host/port/username on reload
// Secrets (password, key, CF token, SOCKS pass, SSH pass) are intentionally NEVER persisted
const PERSIST_KEY = 'deploy_wizard_form_v1';
const loadPersisted = () => {
  try { return JSON.parse(localStorage.getItem(PERSIST_KEY)) || {}; } catch (_e) { void _e; return {}; }
};

export default function DeployWizard({ onSendToAdvanced }) {
  const { t } = useTranslation();
  const persisted = loadPersisted();
  const [step, setStep] = useState(0);
  const [host, setHost] = useState(persisted.host || '');
  const [port, setPort] = useState(persisted.port || 22);
  const [username, setUsername] = useState(persisted.username || 'root');
  const [authMode, setAuthMode] = useState(persisted.authMode || 'password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [serverInfo, setServerInfo] = useState(null);
  const [error, setError] = useState(null);
  const [preflightChecks, setPreflightChecks] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [domain, setDomain] = useState(persisted.domain || '');
  const [backupDomains, setBackupDomains] = useState(persisted.backupDomains || []);
  const [newBackupDomain, setNewBackupDomain] = useState('');
  const [dnsMode, setDnsMode] = useState('manual');
  const [cfToken, setCfToken] = useState('');
  const [dnsResults, setDnsResults] = useState(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [mtu, setMtu] = useState(1232);
  const [socksAuth, setSocksAuth] = useState(false);
  const [socksUser, setSocksUser] = useState('proxy');
  const [socksPass, setSocksPass] = useState('');
  const [sshTunnel, setSshTunnel] = useState(false);
  const [sshUser, setSshUser] = useState('tunnel');
  const [sshPass, setSshPass] = useState('');
  const [sshTransport, setSshTransport] = useState('plain'); // plain|tls|ws|http|payload
  const [sshTlsSni, setSshTlsSni] = useState('');
  const [sshWsPath, setSshWsPath] = useState('/ssh');
  const [sshWsTls, setSshWsTls] = useState(true);
  const [sshWsHost, setSshWsHost] = useState('');
  const [sshHttpProxyHost, setSshHttpProxyHost] = useState('');
  const [sshHttpProxyPort, setSshHttpProxyPort] = useState(8080);
  const [sshPayload, setSshPayload] = useState('CONNECT [host]:[port] HTTP/1.1[crlf]Host: [host][crlf][crlf]');
  const [addXray, setAddXray] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState(null);
  const [configs, setConfigs] = useState(null);
  const [scanVlessConfig, setScanVlessConfig] = useState('');

  // Persist non-sensitive form fields (host/port/username/authMode/domain/backupDomains)
  useEffect(() => {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({ host, port, username, authMode, domain, backupDomains }));
    } catch (_e) { void _e; /* localStorage may be unavailable in private mode */ }
  }, [host, port, username, authMode, domain, backupDomains]);

  // Poll deploy status
  useEffect(() => {
    if (!deploying) return;
    const iv = setInterval(async () => {
      try {
        const s = await tunnelDeployStatus();
        setDeployStatus(s);
        if (s.status === 'completed') { setDeploying(false); setConfigs(s.configs); setStep(5); }
        if (s.status === 'failed' || s.status === 'cancelled') setDeploying(false);
      } catch(e) {}
    }, 1500);
    return () => clearInterval(iv);
  }, [deploying]);

  const doConnect = async () => {
    setConnecting(true); setError(null);
    try {
      const r = await tunnelConnect(host, port, username, authMode==='password'?password:null, authMode==='key'?privateKey:null);
      if (r.success) { setServerInfo(r.server_info); setStep(1); doPreflightAuto(); }
      else setError(r.message);
    } catch(e) { setError(e.message); }
    setConnecting(false);
  };

  const doPreflightAuto = async () => {
    setPreflightLoading(true);
    try { const r = await tunnelPreflight(); setPreflightChecks(r.checks); }
    catch(e) { setError(e.message); }
    setPreflightLoading(false);
  };

  const doVerifyDns = async () => {
    setDnsLoading(true); setError(null);
    try { const r = await tunnelVerifyDns(domain, serverInfo?.public_ip); setDnsResults(r); }
    catch(e) { setError(e.message); }
    setDnsLoading(false);
  };

  const doCreateCfDns = async () => {
    setDnsLoading(true); setError(null);
    try {
      const r = await tunnelCloudflareDns(cfToken, domain, serverInfo?.public_ip);
      if (r.success) { setTimeout(doVerifyDns, 3000); }
      else setError(r.message);
    } catch(e) { setError(e.message); }
    setDnsLoading(false);
  };

  const doDeploy = async () => {
    setDeploying(true); setError(null);
    try {
      await tunnelDeploy({
        domain, mtu,
        backup_domains: backupDomains,
        socks_auth: socksAuth, socks_user: socksUser, socks_pass: socksPass,
        ssh_tunnel_user: sshTunnel, ssh_user: sshUser, ssh_pass: sshPass,
        ssh_transport: sshTransport,
        ssh_tls_sni: sshTlsSni,
        ssh_ws_path: sshWsPath, ssh_ws_tls: sshWsTls, ssh_ws_host: sshWsHost,
        ssh_http_proxy_host: sshHttpProxyHost, ssh_http_proxy_port: sshHttpProxyPort,
        ssh_payload: sshPayload,
        add_xray: addXray,
      });
      setStep(4);
    } catch(e) { setError(e.message); setDeploying(false); }
  };

  const addBackupDomain = () => {
    const d = newBackupDomain.trim().toLowerCase();
    if (!d) return;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) { setError(t('dnsTunnel.invalidDomain', 'Invalid domain name')); return; }
    if (d === domain || backupDomains.includes(d)) return;
    setBackupDomains([...backupDomains, d]);
    setNewBackupDomain('');
    setError(null);
  };
  const removeBackupDomain = (d) => setBackupDomains(backupDomains.filter(x => x !== d));

  const ic = "w-full bg-[#0d0d12] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none font-mono transition-all";

  return (
    <div className="glass-panel p-6 neon-border relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none"/>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">{t('dnsTunnel.deployTitle','Deploy DNS Tunnel')}</h2>
          <p className="text-sm text-gray-400">{t('dnsTunnel.deploySubtitle','Set up unblockable internet on your VPS in minutes')}</p>
        </div>
      </div>
      <StepIndicator current={step} steps={STEPS}/>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* STEP 0: Connect */}
      {step === 0 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <h3 className="text-lg font-bold text-white">{t('dnsTunnel.step1Title','Step 1: Connect to Your Server')}</h3>
          <p className="text-gray-400 text-sm">{t('dnsTunnel.step1Desc','Enter your VPS credentials. We\'ll connect via SSH to set up DNS tunnels.')}</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.serverIp','Server IP')}</label><input className={ic} value={host} onChange={e=>setHost(e.target.value)} placeholder="1.2.3.4"/></div>
            <div><label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.sshPort','SSH Port')}</label><input type="number" className={ic} value={port} onChange={e=>setPort(+e.target.value)}/></div>
          </div>
          <div><label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.username','Username')}</label><input className={ic} value={username} onChange={e=>setUsername(e.target.value)}/></div>
          <div className="flex gap-3">
            <button onClick={()=>setAuthMode('password')} className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-all ${authMode==='password'?'bg-emerald-500/20 border-emerald-500 text-emerald-400':'bg-black/40 border-gray-700 text-gray-400'}`}>🔑 {t('dnsTunnel.password','Password')}</button>
            <button onClick={()=>setAuthMode('key')} className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-all ${authMode==='key'?'bg-emerald-500/20 border-emerald-500 text-emerald-400':'bg-black/40 border-gray-700 text-gray-400'}`}>🔐 {t('dnsTunnel.privateKey','Private Key')}</button>
          </div>
          {authMode==='password' ? (
            <div><label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.password','Password')}</label><input type="password" className={ic} value={password} onChange={e=>setPassword(e.target.value)}/></div>
          ) : (
            <div><label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.privateKey','Private Key')}</label><textarea className={ic+" h-28 resize-none"} value={privateKey} onChange={e=>setPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"/></div>
          )}
          <button onClick={doConnect} disabled={connecting||!host} className={`w-full py-3 rounded-xl font-bold transition-all ${connecting?'bg-gray-800 text-gray-500':'bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]'}`}>
            {connecting ? '⏳ '+t('dnsTunnel.connecting','Connecting...') : '🔌 '+t('dnsTunnel.connect','Connect')}
          </button>
        </div>
      )}

      {/* STEP 1: Preflight */}
      {step === 1 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <h3 className="text-lg font-bold text-white">{t('dnsTunnel.step2Title','Step 2: Server Checks')}</h3>
          {serverInfo && <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm"><span className="text-emerald-400 font-bold">✓ Connected</span> — {serverInfo.hostname} ({serverInfo.os}) — IP: {serverInfo.public_ip}</div>}
          {preflightLoading && <div className="text-center text-emerald-400 animate-pulse py-4">⏳ {t('dnsTunnel.checking','Running checks...')}</div>}
          {preflightChecks && (
            <div className="space-y-2">
              {Object.entries(preflightChecks).map(([k,v]) => (
                <div key={k} className={`flex items-center gap-3 p-3 rounded-lg border ${v.ok?'bg-emerald-500/5 border-emerald-500/20':'bg-red-500/5 border-red-500/20'}`}>
                  <span className="text-lg">{v.ok?'✅':'❌'}</span>
                  <div><span className="font-bold text-white text-sm capitalize">{k.replace('_',' ')}</span><p className="text-xs text-gray-400">{v.detail}</p></div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={()=>setStep(0)} className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold hover:text-white transition-all">← {t('dnsTunnel.back','Back')}</button>
            <button onClick={()=>setStep(2)} className="flex-1 py-2 rounded-xl font-bold bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all">{t('dnsTunnel.next','Next')} →</button>
          </div>
        </div>
      )}

      {/* STEP 2: Domain & DNS */}
      {step === 2 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <h3 className="text-lg font-bold text-white">{t('dnsTunnel.step3Title','Step 3: Domain & DNS Records')}</h3>
          <div><label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.domain','Your Domain')}</label><input className={ic} value={domain} onChange={e=>setDomain(e.target.value)} placeholder="example.com"/></div>
          {/* Backup / failover domains */}
          <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
            <label className="block text-purple-300 text-xs font-bold uppercase mb-2">{t('dnsTunnel.backupDomains','Backup domains (auto-failover)')}</label>
            <div className="flex gap-2">
              <input className={ic} value={newBackupDomain} onChange={e=>setNewBackupDomain(e.target.value)} onKeyDown={e=>{ if (e.key === 'Enter') addBackupDomain(); }} placeholder="backup.example.net"/>
              <button onClick={addBackupDomain} className="px-3 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 text-sm font-bold hover:bg-purple-500/30">+ {t('dnsTunnel.add','Add')}</button>
            </div>
            {backupDomains.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {backupDomains.map(d => (
                  <span key={d} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-xs text-purple-200">
                    <span className="font-mono">{d}</span>
                    <button onClick={()=>removeBackupDomain(d)} className="text-red-400 hover:text-red-300" aria-label={`remove ${d}`}>×</button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[10px] text-purple-200/60 mt-2">{t('dnsTunnel.backupDomainsHint','If the primary domain is blocked or its NS delegation is filtered, clients will rotate to these.')}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={()=>setDnsMode('manual')} className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-all ${dnsMode==='manual'?'bg-emerald-500/20 border-emerald-500 text-emerald-400':'bg-black/40 border-gray-700 text-gray-400'}`}>📋 {t('dnsTunnel.manualDns','Manual Setup')}</button>
            <button onClick={()=>setDnsMode('auto')} className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-all ${dnsMode==='auto'?'bg-emerald-500/20 border-emerald-500 text-emerald-400':'bg-black/40 border-gray-700 text-gray-400'}`}>⚡ {t('dnsTunnel.autoDns','Cloudflare API')}</button>
          </div>
          {dnsMode==='auto' && (
            <div><label className="block text-gray-400 text-xs font-bold uppercase mb-1">{t('dnsTunnel.cfToken','Cloudflare API Token')}</label><input type="password" className={ic} value={cfToken} onChange={e=>setCfToken(e.target.value)} placeholder="Your CF API token with DNS edit permission"/>
              <button onClick={doCreateCfDns} disabled={dnsLoading||!cfToken||!domain} className="mt-2 w-full py-2 rounded-lg bg-orange-500/20 border border-orange-500/40 text-orange-400 text-sm font-bold hover:bg-orange-500/30 transition-all">{dnsLoading?'⏳ Creating...':'⚡ Auto-Create 9 DNS Records'}</button>
            </div>
          )}
          {dnsMode==='manual' && domain && (
            <div className="space-y-1">
              <p className="text-xs text-gray-400 mb-2">{t('dnsTunnel.dnsInstructions','Create these records in Cloudflare (DNS Only / grey cloud):')}</p>
              <div className="bg-black/40 rounded-lg p-3 font-mono text-xs space-y-1 border border-gray-800">
                <div className="flex gap-2"><span className="text-yellow-400 w-8">A</span><span className="text-gray-300 w-28">ns.{domain}</span><span className="text-emerald-400">{serverInfo?.public_ip||'YOUR_IP'}</span></div>
                {['t','d','n','v','s','ds','z','vz'].map(sub=>(
                  <div key={sub} className="flex gap-2"><span className="text-blue-400 w-8">NS</span><span className="text-gray-300 w-28">{sub}.{domain}</span><span className="text-emerald-400">ns.{domain}</span></div>
                ))}
              </div>
            </div>
          )}
          <button onClick={doVerifyDns} disabled={dnsLoading||!domain} className="w-full py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-400 text-sm font-bold hover:bg-violet-500/30 transition-all">{dnsLoading?'⏳ Verifying...':'🔍 Verify DNS Records'}</button>
          {dnsResults && (
            <div className="space-y-1">
              {Object.entries(dnsResults.records||{}).map(([k,v])=>(
                <div key={k} className={`flex items-center gap-2 text-xs p-1.5 rounded ${v.ok?'text-emerald-400':'text-red-400'}`}>
                  <span>{v.ok?'✅':'❌'}</span><span className="font-mono">{v.type} {v.name}.{domain}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={()=>setStep(1)} className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold hover:text-white transition-all">← {t('dnsTunnel.back','Back')}</button>
            <button onClick={()=>setStep(3)} disabled={!domain} className="flex-1 py-2 rounded-xl font-bold bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all">{t('dnsTunnel.next','Next')} →</button>
          </div>
        </div>
      )}

      {/* STEP 3: Configure */}
      {step === 3 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <h3 className="text-lg font-bold text-white">{t('dnsTunnel.step4Title','Step 4: Configure Tunnels')}</h3>
          <div><label className="block text-gray-400 text-xs font-bold uppercase mb-1">MTU ({mtu})</label><input type="range" min="512" max="1400" value={mtu} onChange={e=>setMtu(+e.target.value)} className="w-full accent-emerald-500"/><p className="text-[10px] text-gray-500">{t('dnsTunnel.mtuDesc','Lower = more compatible, Higher = faster')}</p></div>
          <div className="p-3 rounded-lg bg-black/40 border border-gray-800 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={socksAuth} onChange={e=>setSocksAuth(e.target.checked)} className="accent-emerald-500"/><span className="text-sm text-white font-bold">{t('dnsTunnel.socksAuth','Enable SOCKS5 Authentication')}</span></label>
            {socksAuth && <div className="grid grid-cols-2 gap-2"><input className={ic} placeholder="Username" value={socksUser} onChange={e=>setSocksUser(e.target.value)}/><input type="password" className={ic} placeholder="Password" value={socksPass} onChange={e=>setSocksPass(e.target.value)}/></div>}
          </div>
          <div className="p-3 rounded-lg bg-black/40 border border-gray-800 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={sshTunnel} onChange={e=>setSshTunnel(e.target.checked)} className="accent-emerald-500"/><span className="text-sm text-white font-bold">{t('dnsTunnel.sshTunnelUser','Create SSH Tunnel User')}</span></label>
            {sshTunnel && <div className="grid grid-cols-2 gap-2"><input className={ic} placeholder="Username" value={sshUser} onChange={e=>setSshUser(e.target.value)}/><input type="password" className={ic} placeholder="Password" value={sshPass} onChange={e=>setSshPass(e.target.value)}/></div>}
            {sshTunnel && (
              <div className="space-y-2 pt-2 border-t border-gray-800">
                <label className="block text-gray-400 text-[10px] font-bold uppercase">{t('dnsTunnel.sshTransport','SSH transport')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'plain', label: 'Plain SSH' },
                    { id: 'tls', label: 'SSH-over-TLS (SNI)' },
                    { id: 'ws', label: 'SSH-over-WS' },
                    { id: 'http', label: 'SSH-over-HTTP-CONNECT' },
                    { id: 'payload', label: 'Payload Injection' },
                  ].map(p => (
                    <button key={p.id} onClick={()=>setSshTransport(p.id)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition ${sshTransport===p.id?'bg-cyan-500/25 border-cyan-500/50 text-cyan-200':'bg-black/40 border-gray-700 text-gray-400 hover:text-white'}`}>{p.label}</button>
                  ))}
                </div>
                {sshTransport === 'tls' && (
                  <input className={ic} value={sshTlsSni} onChange={e=>setSshTlsSni(e.target.value)} placeholder="SNI host (e.g. www.cloudflare.com)"/>
                )}
                {sshTransport === 'ws' && (
                  <div className="grid grid-cols-3 gap-2">
                    <input className={ic} value={sshWsPath} onChange={e=>setSshWsPath(e.target.value)} placeholder="Path (/ssh)"/>
                    <input className={ic} value={sshWsHost} onChange={e=>setSshWsHost(e.target.value)} placeholder="Host header"/>
                    <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={sshWsTls} onChange={e=>setSshWsTls(e.target.checked)} className="accent-cyan-500"/>wss (TLS)</label>
                  </div>
                )}
                {sshTransport === 'http' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input className={ic} value={sshHttpProxyHost} onChange={e=>setSshHttpProxyHost(e.target.value)} placeholder="Upstream proxy host"/>
                    <input type="number" className={ic} value={sshHttpProxyPort} onChange={e=>setSshHttpProxyPort(+e.target.value)} placeholder="Port"/>
                  </div>
                )}
                {sshTransport === 'payload' && (
                  <div>
                    <textarea rows={3} className={`${ic} font-mono text-xs`} value={sshPayload} onChange={e=>setSshPayload(e.target.value)} placeholder="CONNECT [host]:[port] HTTP/1.1[crlf]Host: [host][crlf][crlf]"/>
                    <p className="text-[10px] text-gray-500 mt-1">{t('dnsTunnel.payloadHint','Use placeholders [host] [port] [crlf] [lf]. Sent before SSH banner exchange.')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="p-3 rounded-lg bg-black/40 border border-gray-800">
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={addXray} onChange={e=>setAddXray(e.target.checked)} className="accent-violet-500"/><span className="text-sm text-white font-bold">{t('dnsTunnel.addXray','Add Xray Backend (VLESS/VMess/SS/Trojan)')}</span></label>
            {addXray && <p className="text-[10px] text-gray-500 mt-1">{t('dnsTunnel.xrayDesc','Connects existing 3x-ui panel to DNS tunnel for modern proxy protocols over DNS.')}</p>}
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 text-xs text-gray-300">
            <p className="font-bold text-emerald-400 mb-1">📦 {t('dnsTunnel.willDeploy','Will deploy:')}</p>
            <p>• 4 SOCKS tunnels: Slipstream + DNSTT + NoizDNS + VayDNS</p>
            <p>• 4 SSH tunnels: Slipstream + DNSTT + NoizDNS + VayDNS</p>
            {addXray && <p>• Xray backend (VLESS/VMess/SS/Trojan over DNS)</p>}
          </div>
          <div className="flex gap-3">
            <button onClick={()=>setStep(2)} className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold hover:text-white transition-all">← {t('dnsTunnel.back','Back')}</button>
            <button onClick={doDeploy} className="flex-1 py-3 rounded-xl font-bold bg-gradient-to-r from-emerald-500 to-teal-500 text-black hover:from-emerald-400 hover:to-teal-400 shadow-[0_0_30px_rgba(16,185,129,0.5)] transition-all">🚀 {t('dnsTunnel.deploy','Deploy Now')}</button>
          </div>
        </div>
      )}

      {/* STEP 4: Deploying */}
      {step === 4 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <h3 className="text-lg font-bold text-white">{t('dnsTunnel.step5Title','Step 5: Deploying...')}</h3>
          {deployStatus && (
            <>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500 rounded-full" style={{width:`${deployStatus.progress||0}%`}}/></div>
                <span className="text-emerald-400 text-sm font-mono">{deployStatus.progress||0}%</span>
              </div>
              <p className="text-sm text-emerald-400 animate-pulse">{deployStatus.phase}</p>
              <div className="bg-black rounded-lg p-3 font-mono text-xs h-48 overflow-y-auto border border-gray-800 space-y-0.5">
                {(deployStatus.logs||[]).map((l,i)=>(
                  <div key={i} className={l.level==='error'?'text-red-400':l.level==='warn'?'text-yellow-400':l.level==='success'?'text-emerald-400':'text-gray-400'}>{l.msg}</div>
                ))}
              </div>
              {deployStatus.status === 'failed' && <div className="text-red-400 text-sm font-bold">❌ {deployStatus.error}</div>}
            </>
          )}
          {deploying && <button onClick={async()=>{await tunnelDeployCancel();setDeploying(false);}} className="w-full py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 text-sm font-bold">⏹ Cancel</button>}
        </div>
      )}

      {/* STEP 5: Results */}
      {step === 5 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="text-center py-4">
            <div className="text-5xl mb-3">🎉</div>
            <h3 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">{t('dnsTunnel.step6Title','Deployment Complete!')}</h3>
            <p className="text-gray-400 text-sm mt-1">{t('dnsTunnel.step6Desc','Your DNS tunnels are live. Here are your configs:')}</p>
          </div>
          {configs && (
            <div className="space-y-3">
              {Object.entries(configs.share_urls||{}).map(([tag,url])=>(
                <div key={tag} className="p-3 rounded-lg bg-black/40 border border-gray-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-emerald-400 font-bold text-sm">{tag}</span>
                    <button onClick={()=>{navigator.clipboard.writeText(url)}} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 transition-all">📋 Copy</button>
                  </div>
                  <p className="font-mono text-[10px] text-gray-500 break-all">{url}</p>
                </div>
              ))}
              <div className="p-4 rounded-lg bg-violet-500/5 border border-violet-500/20">
                <p className="text-violet-400 font-bold text-sm mb-2">📱 {t('dnsTunnel.clientApps','Download Client Apps:')}</p>
                <div className="space-y-1 text-xs">
                  <a href="https://github.com/anonvector/SlipNet/releases" target="_blank" rel="noopener noreferrer" className="block text-blue-400 hover:text-blue-300">🤖 SlipNet (Android) — github.com/anonvector/SlipNet</a>
                  <a href="https://github.com/anonvector/SlipNet/releases" target="_blank" rel="noopener noreferrer" className="block text-blue-400 hover:text-blue-300">💻 SlipNet CLI (Windows/Mac/Linux)</a>
                  <p className="text-gray-500">📱 iOS: Use HTTP Injector with DNSTT tunnel</p>
                </div>
              </div>
            </div>
          )}
          {onSendToAdvanced && (
            <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/30 space-y-3">
              <p className="text-emerald-400 font-bold text-sm">🔬 Scan with Advanced Scanners</p>
              <p className="text-gray-400 text-xs">Paste your VLESS config to test the deployed tunnel's performance.</p>
              <textarea className={ic + " h-16 resize-none"} value={scanVlessConfig} onChange={e => setScanVlessConfig(e.target.value)} placeholder="vless://..."/>
              <button
                type="button"
                onClick={() => onSendToAdvanced({
                  mode: 'dns_tunnel',
                  dnsTestMode: 'dnstt',
                  nameservers: serverInfo?.public_ip || '',
                  dnsDomain: domain,
                  vlessConfig: scanVlessConfig,
                  targetIp: serverInfo?.public_ip || '',
                })}
                disabled={!scanVlessConfig || !domain}
                className={`w-full py-2 rounded-lg text-sm font-bold transition-all ${!scanVlessConfig || !domain ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]'}`}
              >
                🚀 Scan with Advanced Scanners
              </button>
            </div>
          )}
          <button onClick={()=>{setStep(0);setServerInfo(null);setConfigs(null);setDeployStatus(null);}} className="w-full py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-bold hover:text-white transition-all">🔄 {t('dnsTunnel.startOver','Start Over')}</button>
        </div>
      )}
    </div>
  );
}
