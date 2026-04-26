/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import { toast } from 'react-hot-toast';
import { Shield, Lock, Unlock, Server, Activity, ArrowRight, CheckCircle2, RefreshCw, Copy, Zap, Trophy, Wifi, Clock } from 'lucide-react';
import { getGamificationStatus, getFreeConfigs, startMixAndTest, getMixTestStatus } from '../api';

export default function FreeVpnDashboard({ onStartContribution }) {
    const { t } = useTranslation();
    const [subTab, setSubTab] = useState('free'); // 'free' | 'vip'

    // Telegram Auth State
    const [telegramAuth, setTelegramAuth] = useState(false);
    const [authCode, setAuthCode] = useState(null);
    const [isPolling, setIsPolling] = useState(false);
    const [telegramInfo, setTelegramInfo] = useState(null);
    const [joinedChannel, setJoinedChannel] = useState(false);

    // Gamification State
    const [scansCount, setScansCount] = useState(0);
    const [recentScans, setRecentScans] = useState(0);
    const [scanRequirementMet, setScanRequirementMet] = useState(false);
    const [freeConfigs, setFreeConfigs] = useState([]);

    // Mix & Test State
    const [mixJobId, setMixJobId] = useState(null);
    const [mixRunning, setMixRunning] = useState(false);
    const [mixPhase, setMixPhase] = useState('');
    const [mixProgress, setMixProgress] = useState(0);
    const [mixTotal, setMixTotal] = useState(0);
    const [mixTested, setMixTested] = useState(0);
    const [mixTop10, setMixTop10] = useState([]);
    const [mixError, setMixError] = useState(null);
    const [mixDone, setMixDone] = useState(false);
    const [mixConfigCount, setMixConfigCount] = useState(0);
    const [mixIpCount, setMixIpCount] = useState(0);

    // Initialize Auth from LocalStorage on Mount
    useEffect(() => {
        const cachedAuth = localStorage.getItem('tg_auth_session');
        if (cachedAuth) {
            try {
                const parsed = JSON.parse(cachedAuth);
                setTelegramInfo(parsed);
                setTelegramAuth(true);
            } catch (e) {
                localStorage.removeItem('tg_auth_session');
            }
        }
        // Always fetch contribution status on mount, regardless of Telegram auth
        checkUserContribution();
    }, []);

    // Poll contribution status so VIP progress reflects active scans LIVE.
    // BUG FIX: previously the poll stopped as soon as `scanRequirementMet`
    // (10 recent scans) flipped true, which froze the "X / 10,000" VIP
    // counter — so the Claim VIP tab never showed the user's real, growing
    // scan total. We now keep polling until VIP is actually unlocked, and
    // we slow the cadence down once the basic requirement is met to save
    // CPU/network.
    useEffect(() => {
        if (scansCount >= 10000) return; // VIP already unlocked — no need to poll
        const intervalMs = scanRequirementMet ? 30000 : 10000;
        const interval = setInterval(() => {
            checkUserContribution();
        }, intervalMs);
        return () => clearInterval(interval);
    }, [scanRequirementMet, scansCount]);

    // Poll the backend for Telegram Auth Confirmation — auto-stops after 5 minutes (100 polls × 3s)
    useEffect(() => {
        let interval;
        let pollCount = 0;
        const MAX_POLLS = 100; // 5 minutes
        if (isPolling && authCode) {
            interval = setInterval(async () => {
                pollCount += 1;
                if (pollCount > MAX_POLLS) {
                    setIsPolling(false);
                    setAuthCode(null);
                    toast.error('Telegram auth timed out after 5 minutes. Please try again.');
                    clearInterval(interval);
                    return;
                }
                try {
                    const adminUrl = import.meta.env.VITE_ADMIN_PANEL_URL || '';
                    const res = await fetch(`${adminUrl}/api/auth/status/${authCode}`);
                    const data = await res.json();

                    if (data.success) {
                        setTelegramAuth(true);
                        setIsPolling(false);
                        setTelegramInfo(data);
                        
                        // Persist to LocalStorage forever
                        localStorage.setItem('tg_auth_session', JSON.stringify(data));
                        
                        toast.success(`Welcome to the community, @${data.username}!`);
                        clearInterval(interval);

                        // Check desktop database for scan history after login
                        checkUserContribution();
                    } else if (data.status === 'expired') {
                        setIsPolling(false);
                        setAuthCode(null);
                        toast.error("Auth code expired. Try again.");
                        clearInterval(interval);
                    }
                } catch (e) {
                    // Silent fail on polling errors
                }
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [isPolling, authCode]);

    const checkUserContribution = async () => {
        try {
            const status = await getGamificationStatus();
            if (status.success) {
                setScanRequirementMet(status.has_scanned_recently);
                setScansCount(status.total_scans || 0);
                setRecentScans(status.recent_scans || 0);

                if (status.has_scanned_recently) {
                    loadFreeConfigs();
                }
            } else {
                toast.error("Failed to fetch contribution status.");
            }
        } catch (e) {
            console.error("Contribution check error", e);
        }
    };

    const loadFreeConfigs = async () => {
        try {
            const res = await getFreeConfigs();
            if (res.success) {
                setFreeConfigs(res.configs);
            }
        } catch (e) {
            console.error(e);
        }
    };

    // Mix & Test: poll job status
    useEffect(() => {
        if (!mixJobId || mixDone) return;
        const interval = setInterval(async () => {
            try {
                const res = await getMixTestStatus(mixJobId);
                if (res.success) {
                    setMixPhase(res.phase || '');
                    setMixProgress(res.progress || 0);
                    setMixTotal(res.total || 0);
                    setMixTested(res.tested || 0);
                    if (res.config_count) setMixConfigCount(res.config_count);
                    if (res.ip_count) setMixIpCount(res.ip_count);
                    if (res.done) {
                        setMixDone(true);
                        setMixRunning(false);
                        if (res.error) {
                            setMixError(res.error);
                            toast.error(res.error);
                        } else {
                            setMixTop10(res.top10 || []);
                            if ((res.top10 || []).length > 0) {
                                toast.success(`Found ${res.top10.length} best configs!`);
                            }
                        }
                        clearInterval(interval);
                    }
                }
            } catch (e) {
                console.error("Mix poll error", e);
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [mixJobId, mixDone]);

    const handleStartMixTest = async () => {
        setMixRunning(true);
        setMixDone(false);
        setMixError(null);
        setMixTop10([]);
        setMixProgress(0);
        setMixPhase('fetching');
        setMixTested(0);
        setMixTotal(0);
        setMixConfigCount(0);
        setMixIpCount(0);
        try {
            const res = await startMixAndTest();
            if (res.success && res.job_id) {
                setMixJobId(res.job_id);
                toast.success("Mix & Test started! Testing all combinations...");
            } else {
                setMixRunning(false);
                toast.error("Failed to start Mix & Test");
            }
        } catch (e) {
            setMixRunning(false);
            toast.error("Network error starting Mix & Test");
        }
    };

    const startTelegramLogin = async () => {
        try {
            const toastId = toast.loading("Reaching auth server...");
            const adminUrl = import.meta.env.VITE_ADMIN_PANEL_URL || '';
            const res = await fetch(`${adminUrl}/api/auth/request`);
            const data = await res.json();

            toast.dismiss(toastId);

            if (data.success) {
                setAuthCode(data.code);
                setIsPolling(true);
            } else {
                toast.error("Failed to reach Admin Server.");
            }
        } catch (e) {
            toast.dismiss();
            toast.error("Admin Server Offline.");
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 pb-12">

            {/* Header & Telegram Auth */}
            <div className="glass-panel p-6 neon-border flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center gap-2">
                        <Shield className="w-6 h-6 text-cyan-400" />
                        {t('freevpn.title', 'Community VPN Ecosystem')}
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">
                        {t('freevpn.subtitle', 'Access free community configs or earn dedicated VIP servers by contributing to the network.')}
                    </p>
                </div>

                {!telegramAuth ? (
                    <div className="flex flex-col items-end gap-2">
                        {authCode ? (
                            <div className="flex flex-col items-center bg-[#2AABEE]/10 border border-[#2AABEE]/30 p-4 rounded-xl min-w-[250px]">
                                <span className="text-xs text-[#2AABEE] font-bold uppercase tracking-wider mb-2">{t('freevpn.messageBot', 'Message Bot This Code')}</span>
                                <span className="text-4xl font-black tracking-widest text-white drop-shadow-[0_0_15px_rgba(42,171,238,0.8)] mb-3">{authCode}</span>
                                
                                <div className="flex gap-2 w-full">
                                    <button 
                                        onClick={() => {
                                            navigator.clipboard.writeText(authCode);
                                            toast.success("Code copied!");
                                        }}
                                        className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1"
                                    >
                                        <Copy className="w-3 h-3" /> {t('freevpn.copy', 'Copy')}
                                    </button>
                                    
                                    <a 
                                        href={`https://t.me/antigravity_ip_bot?start=${authCode}`}
                                        target="_blank" rel="noreferrer"
                                        className="flex-[2] bg-[#2AABEE] hover:bg-[#229ED9] text-white py-2 rounded-lg text-xs font-black transition-colors flex items-center justify-center gap-1 shadow-[0_0_15px_rgba(42,171,238,0.4)]"
                                    >
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" /></svg>
                                        {t('freevpn.openApp', 'Open App & Send')}
                                    </a>
                                </div>
                                
                                <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                                    <RefreshCw className="w-3 h-3 animate-spin text-[#2AABEE]" /> {t('freevpn.waitingForYou', 'Waiting for you...')}
                                </div>
                            </div>
                        ) : !joinedChannel ? (
                            <div className="flex flex-col items-end gap-2">
                                <a 
                                    href="https://t.me/ANTIGRAVITY_IP"
                                    target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2AABEE] hover:bg-[#229ED9] text-white font-bold transition-all shadow-[0_0_15px_rgba(42,171,238,0.3)] text-sm"
                                >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" /></svg>
                                    {t('freevpn.joinChannel', 'Join @ANTIGRAVITY_IP')}
                                </a>
                                <button
                                    onClick={() => setJoinedChannel(true)}
                                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-400 transition-colors"
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {t('freevpn.iJoined', "I've joined the channel")}
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={startTelegramLogin}
                                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#2AABEE]/20 text-[#2AABEE] border border-[#2AABEE]/50 hover:bg-[#2AABEE]/30 hover:shadow-[0_0_15px_rgba(42,171,238,0.4)] transition-all font-bold"
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" /></svg>
                                {t('freevpn.loginTelegram', 'Login with Telegram')}
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-end">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-bold shadow-[0_0_15px_rgba(34,197,94,0.2)]">
                            <CheckCircle2 className="w-4 h-4" />
                            {telegramInfo ? `@${telegramInfo.username}` : t('freevpn.authenticated', 'Authenticated')}
                        </div>
                    </div>
                )}
            </div>

            {/* Sub-Tabs Navigation */}
            <div className="flex justify-center gap-4 mb-6">
                <button
                    onClick={() => setSubTab('free')}
                    className={`px-8 py-3 rounded-xl font-bold transition-all ${subTab === 'free' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-white/5 text-gray-400 hover:text-white border border-transparent'}`}
                >
                    {t('freevpn.tabFree', 'Free Community Configs')}
                </button>
                <button
                    onClick={() => setSubTab('vip')}
                    className={`px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 ${subTab === 'vip' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'bg-white/5 text-gray-400 hover:text-white border border-transparent'}`}
                >
                    <Lock className="w-4 h-4" />
                    {t('freevpn.tabVip', 'Claim VIP Server')}
                </button>
            </div>

            {!telegramAuth ? (
                <div className="glass-panel p-10 text-center flex flex-col items-center justify-center min-h-[300px]">
                    <Lock className="w-16 h-16 text-gray-600 mb-4" />
                    <h3 className="text-xl font-bold text-gray-300 mb-2">{t('freevpn.authRequired', 'Authentication Required')}</h3>
                    <p className="text-gray-500 max-w-md mb-4">
                        {t('freevpn.authDesc', 'You must join our Telegram community and authenticate via the bot to access the free VPN ecosystem.')}
                    </p>

                    {/* Step 1: Join Channel (mandatory) */}
                    <div className="max-w-md w-full bg-[#2AABEE]/5 border border-[#2AABEE]/20 rounded-xl p-5 mb-4">
                        <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#2AABEE]/20 flex items-center justify-center text-[#2AABEE] font-black text-sm">1</div>
                            <div className="text-left flex-1">
                                <h4 className="text-sm font-bold text-[#2AABEE] mb-1">{t('freevpn.joinChannelTitle', 'Join Our Telegram Community')}</h4>
                                <p className="text-xs text-gray-400 mb-3">{t('freevpn.joinChannelDesc', 'Membership is required. The bot will verify your subscription before authenticating.')}</p>
                                <a 
                                    href="https://t.me/ANTIGRAVITY_IP"
                                    target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#2AABEE] hover:bg-[#229ED9] text-white text-sm font-bold transition-all shadow-[0_0_15px_rgba(42,171,238,0.3)] hover:shadow-[0_0_20px_rgba(42,171,238,0.5)]"
                                >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" /></svg>
                                    {t('freevpn.joinChannel', 'Join @ANTIGRAVITY_IP')}
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* Step 2: Login with Bot */}
                    <div className="max-w-md w-full bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 mb-6">
                        <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 font-black text-sm">2</div>
                            <div className="text-left flex-1">
                                <h4 className="text-sm font-bold text-gray-300 mb-1">{t('freevpn.loginStepTitle', 'Authenticate via Bot')}</h4>
                                <p className="text-xs text-gray-500">{t('freevpn.loginStepDesc', 'After joining, click "Login with Telegram" above to get a 6-digit code and send it to the bot.')}</p>
                            </div>
                        </div>
                    </div>

                    {/* Show contribution progress even before login */}
                    {(scansCount > 0 || recentScans > 0) && (
                        <div className="max-w-sm w-full bg-gray-900/50 p-4 rounded-xl border border-gray-800 shadow-inner">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-gray-400 text-sm font-semibold">{t('freevpn.scanContributions', 'Your Scan Contributions')}</span>
                                <span className="text-cyan-400 font-bold text-sm">{scansCount.toLocaleString()} {t('freevpn.total', 'total')}</span>
                            </div>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-gray-500 text-xs">{t('freevpn.recentScans', 'Recent (last 3 days)')}</span>
                                <span className="text-orange-400 font-bold text-sm">{recentScans} / 10 {t('freevpn.ips', 'IPs')}</span>
                            </div>
                            <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden border border-gray-700">
                                <div 
                                    className="bg-gradient-to-r from-orange-600 to-amber-500 h-2.5 rounded-full transition-all duration-1000"
                                    style={{ width: `${Math.min(100, (recentScans / 10) * 100)}%` }}
                                ></div>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">{t('freevpn.loginToUnlock', 'Login with Telegram above to unlock configs')}</p>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    {/* FREE CONFIGS TAB */}
                    {subTab === 'free' && (
                        <div className="space-y-6">
                            {!scanRequirementMet ? (
                                <div className="glass-panel p-8 text-center border-orange-500/30 bg-orange-500/5">
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/20 mb-4 shadow-[0_0_20px_rgba(249,115,22,0.4)]">
                                        <Activity className="w-8 h-8 text-orange-400" />
                                    </div>
                                    <h3 className="text-xl font-bold text-orange-400 mb-2">{t('freevpn.scanRequired', 'Contribution Required')}</h3>
                                    <p className="text-gray-400 max-w-lg mx-auto mb-6 leading-relaxed">
                                        {t('freevpn.scanDesc', 'To unlock access to the community configs, you must give back to the network. Please run an IP scan and find at least 10 Clean IPs within the last 3 days.')}
                                    </p>

                                    <div className="max-w-md mx-auto mb-6 bg-gray-900/50 p-4 rounded-xl border border-gray-800 shadow-inner">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-gray-400 text-sm font-semibold">{t('freevpn.recentContribution', 'Your Recent Contribution')}</span>
                                            <span className="text-orange-400 font-bold">{recentScans} / 10 {t('freevpn.ips', 'IPs')}</span>
                                        </div>
                                        <div className="w-full bg-gray-800 rounded-full h-3 mb-2 overflow-hidden border border-gray-700">
                                            <div 
                                                className="bg-gradient-to-r from-orange-600 to-amber-500 h-3 rounded-full transition-all duration-1000"
                                                style={{ width: `${Math.min(100, (recentScans / 10) * 100)}%` }}
                                            ></div>
                                        </div>
                                        {recentScans > 0 && <p className="text-xs text-orange-400 animate-pulse mt-2">{t('freevpn.almostThere', 'Almost there! Keep finding those good IPs...')}</p>}
                                    </div>

                                    <button onClick={onStartContribution} className="px-8 py-3 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold hover:scale-105 transition-all shadow-lg shadow-orange-500/30 flex items-center justify-center gap-2 mx-auto">
                                        {t('freevpn.goToScanner', 'Go to Scanner')}
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-300 flex items-center gap-2">
                                                <Zap className="w-5 h-5 text-yellow-400" />
                                                {t('freevpn.mixTitle', 'Community Configs — Mix & Test')}
                                            </h3>
                                            <p className="text-sm text-gray-500 mt-1">
                                                {t('freevpn.mixDesc', 'Picks top 5 fastest CF configs')}{mixConfigCount > 0 ? ` (${mixConfigCount} ${t('freevpn.available', 'available')})` : ''}, {t('freevpn.mixDesc2', 'mixes with top 3 found IPs')}{mixIpCount > 0 ? ` (${mixIpCount} ${t('freevpn.ips', 'IPs')})` : ''}, {t('freevpn.mixDesc3', 'tests all')} {mixTotal > 0 ? mixTotal : 15} {t('freevpn.mixDesc4', 'combos')}.
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleStartMixTest}
                                            disabled={mixRunning}
                                            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${
                                                mixRunning
                                                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                                    : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:scale-105 shadow-lg shadow-cyan-500/30'
                                            }`}
                                        >
                                            {mixRunning ? (
                                                <><RefreshCw className="w-4 h-4 animate-spin" /> {t('freevpn.testing', 'Testing...')}</>
                                            ) : (
                                                <><Zap className="w-4 h-4" /> {mixDone ? t('freevpn.retestAll', 'Re-Test All') : t('freevpn.mixAndTestAll', 'Mix & Test All')}</>
                                            )}
                                        </button>
                                    </div>

                                    {/* Progress Bar */}
                                    {mixRunning && (
                                        <div className="glass-panel p-4 border-cyan-500/20">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-sm text-gray-400 font-semibold flex items-center gap-2">
                                                    <Clock className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                                                    {mixPhase === 'fetching' && t('freevpn.fetching', 'Fetching top 5 configs & top 3 IPs...')}
                                                    {mixPhase === 'quick_test' && `${t('freevpn.quickPing', 'Quick ping test —')} ${mixTested}/${mixTotal} ${t('freevpn.combos', 'combos')}${mixConfigCount > 0 ? ` (${mixConfigCount} CF configs available)` : ''}`}
                                                    {mixPhase === 'speed_test' && t('freevpn.speedTest', 'Speed testing top candidates...')}
                                                </span>
                                                <span className="text-cyan-400 font-bold text-sm">{mixProgress}%</span>
                                            </div>
                                            <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden border border-gray-700">
                                                <div
                                                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2.5 rounded-full transition-all duration-500"
                                                    style={{ width: `${mixProgress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Error */}
                                    {mixError && (
                                        <div className="glass-panel p-4 border-red-500/30 bg-red-500/5 text-red-400 text-sm">
                                            {mixError}
                                        </div>
                                    )}

                                    {/* Top 10 Results */}
                                    {mixTop10.length > 0 && (
                                        <div className="space-y-3">
                                            <h4 className="text-sm font-bold text-yellow-400 flex items-center gap-2">
                                                <Trophy className="w-4 h-4" />
                                                {t('freevpn.topConfigsPrefix', 'Top')} {mixTop10.length} {t('freevpn.topConfigsSuffix', 'Best Configs (Ranked by Quality)')}
                                            </h4>
                                            <div className="space-y-2">
                                                {mixTop10.map((item, i) => (
                                                    <div key={i} className={`bg-black/40 border rounded-xl p-4 hover:border-cyan-500/60 transition-all ${i === 0 ? 'border-yellow-500/50 bg-yellow-500/5' : i < 3 ? 'border-cyan-500/30' : 'border-gray-700'}`}>
                                                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                            <div className="flex items-center gap-3">
                                                                <span className={`text-lg font-black ${i === 0 ? 'text-yellow-400' : i < 3 ? 'text-cyan-400' : 'text-gray-500'}`}>
                                                                    #{i + 1}
                                                                </span>
                                                                <span className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400 font-mono">{item.ip}</span>
                                                                <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded">{item.datacenter}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3 text-xs">
                                                                <span className="flex items-center gap-1 text-green-400">
                                                                    <Wifi className="w-3 h-3" /> {item.ping}ms
                                                                </span>
                                                                <span className="text-orange-400">J: {item.jitter}ms</span>
                                                                <span className="text-cyan-400 font-bold">{item.download > 1024 ? `${(item.download / 1024).toFixed(1)} MB/s` : `${item.download} KB/s`} ↓</span>
                                                                <span className="text-blue-400">{item.upload > 1024 ? `${(item.upload / 1024).toFixed(1)} MB/s` : `${item.upload} KB/s`} ↑</span>
                                                                <span className={`font-bold px-2 py-0.5 rounded ${item.score > 100 ? 'text-yellow-400 bg-yellow-500/10' : item.score > 50 ? 'text-green-400 bg-green-500/10' : 'text-gray-400 bg-gray-800'}`}>
                                                                    {t('freevpn.score', 'Score')}: {item.score}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="bg-black p-2.5 rounded font-mono text-xs text-gray-500 break-all select-all hover:text-gray-300 transition-colors mb-2 line-clamp-1">
                                                            {item.config_link}
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(item.config_link);
                                                                toast.success(`Config #${i + 1} copied!`);
                                                            }}
                                                            className="w-full flex items-center justify-center gap-2 bg-cyan-500/10 text-cyan-400 py-2 rounded hover:bg-cyan-500/20 transition-colors text-sm font-bold"
                                                        >
                                                            <Copy className="w-3.5 h-3.5" /> {t('freevpn.copyConfig', 'Copy Config')}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Copy All Top 10 */}
                                            <button
                                                onClick={() => {
                                                    const allConfigs = mixTop10.map(c => c.config_link).join('\n');
                                                    navigator.clipboard.writeText(allConfigs);
                                                    toast.success("All top configs copied!");
                                                }}
                                                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-400 border border-yellow-500/30 py-3 rounded-xl hover:border-yellow-500/50 transition-all text-sm font-bold"
                                            >
                                                <Copy className="w-4 h-4" /> {t('freevpn.copyAll', 'Copy All')} {mixTop10.length} {t('freevpn.configs', 'Configs')}
                                            </button>
                                        </div>
                                    )}

                                    {/* Original injected configs below (existing feature) */}
                                    {!mixRunning && mixTop10.length === 0 && (
                                        <div>
                                            <p className="text-xs text-gray-600 mb-3 mt-4">{t('freevpn.browsePreInjected', 'Or browse pre-injected configs (not speed-tested):')}</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {freeConfigs.length > 0 ? freeConfigs.map((item, i) => (
                                            <div key={i} className="bg-black/40 border border-[#2AABEE]/30 rounded-xl p-4 hover:border-[#2AABEE]/80 transition-all group">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="text-sm font-bold text-[#2AABEE] flex items-center gap-1">
                                                        <Server className="w-4 h-4" />
                                                        {t('freevpn.source', 'Source')}: {item.source}
                                                    </div>
                                                    <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded">{t('freevpn.injectedIp', 'Injected IP')}: {item.clean_ip}</span>
                                                </div>
                                                <div className="bg-black p-3 rounded font-mono text-xs text-gray-500 break-all select-all flex justify-between items-center group-hover:text-gray-300 transition-colors">
                                                    <span className="line-clamp-2">{item.injected}</span>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(item.injected);
                                                        toast.success("Config Copied!");
                                                    }}
                                                    className="w-full mt-3 flex items-center justify-center gap-2 bg-[#2AABEE]/10 text-[#2AABEE] py-2 rounded hover:bg-[#2AABEE]/20 transition-colors text-sm font-bold"
                                                >
                                                    <Copy className="w-4 h-4" /> {t('freevpn.copyOptimized', 'Copy Optimized Config')}
                                                </button>
                                            </div>
                                        )) : (
                                            <div className="col-span-2 text-center text-gray-500 py-8">
                                                {t('freevpn.loadingConfigs', 'Loading configs from Admin Pool...')}
                                            </div>
                                        )}
                                    </div>
                                    </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* VIP CONFIGS TAB */}
                    {subTab === 'vip' && (
                        <div className="glass-panel p-8 text-center border-purple-500/30 bg-purple-500/5 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gray-800">
                                <div className="h-full bg-gradient-to-r from-purple-600 to-pink-500 transition-all duration-1000" style={{ width: `${(scansCount / 10000) * 100}%` }}></div>
                            </div>

                            <img src="https://cdn-icons-png.flaticon.com/512/5753/5753177.png" alt="VIP" className="w-24 h-24 mx-auto mb-4 opacity-80 drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]" />

                            <h3 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2">
                                {t('freevpn.vipTitle', 'Earn a Dedicated VIP Server')}
                            </h3>
                            <p className="text-gray-400 max-w-xl mx-auto mb-8">
                                {t('freevpn.vipDesc', 'Contribute 10,000 successful IP scans to the global database to earn a private 10GB high-speed VIP Config valid for 7 days.')}
                            </p>

                            <div className="bg-black/50 rounded-xl p-6 max-w-md mx-auto mb-8 border border-white/5 shadow-inner">
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-gray-400">{t('freevpn.yourProgress', 'Your Progress')}</span>
                                    <span className="text-purple-400 font-mono font-bold">{scansCount.toLocaleString()} / 10,000</span>
                                </div>
                                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-purple-600 to-pink-500 transition-all duration-1000" style={{ width: `${(scansCount / 10000) * 100}%` }}></div>
                                </div>
                            </div>

                            {scansCount >= 10000 ? (
                                <button
                                    onClick={() => toast.success("Claiming VIP on server functionality coming soon!")}
                                    className="px-8 py-4 rounded-xl font-black text-lg transition-all flex items-center justify-center gap-3 mx-auto bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-[0_0_30px_rgba(168,85,247,0.6)] hover:scale-105"
                                >
                                    <Server className="w-5 h-5" />
                                    {t('freevpn.claimBtn', 'Claim VIP Config')}
                                </button>
                            ) : (
                                <button
                                    onClick={onStartContribution}
                                    className="px-8 py-4 rounded-xl font-black text-lg transition-all flex items-center justify-center gap-3 mx-auto bg-gray-800 text-white border border-purple-500/30 hover:border-purple-500 hover:bg-gray-700 hover:scale-105 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                                >
                                    <Activity className="w-5 h-5 text-purple-400 animate-pulse" />
                                    {t('freevpn.scanToEarn', 'Scan IPs to Earn VIP')}
                                </button>
                            )}
                        </div>
                    )}
                </>
            )}
        </div >
    );
}
