/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';

const CollapsibleSection = ({ title, icon, children, defaultOpen = false, color = 'neon-purple' }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={`border border-white/10 rounded-xl overflow-hidden mb-3 transition-all ${open ? `shadow-[0_0_15px_rgba(${color === 'neon-blue' ? '0,243,255' : '188,19,254'},0.1)]` : ''}`}>
            <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 transition-all text-left">
                <span className="text-lg">{icon}</span>
                <span className="flex-1 text-sm font-bold text-white">{title}</span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            {open && <div className="px-4 py-4 bg-black/30">{children}</div>}
        </div>
    );
};

export default function DnsScannerGuide() {
    const { t } = useTranslation();
    const [showGuide, setShowGuide] = useState(false);

    return (
        <div className="mt-4">
            <button onClick={() => setShowGuide(!showGuide)} className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-sm font-bold text-gray-400 hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                {showGuide ? t('dnsGuide.hideGuide', 'Hide Guide & Info') : t('dnsGuide.showGuide', 'Show Guide & More Info')}
                <svg className={`w-4 h-4 transition-transform ${showGuide ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>

            {showGuide && (
                <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">

                    {/* ────────── BEGINNER GUIDE ────────── */}
                    <CollapsibleSection title={t('dnsGuide.beginnerTitle', '📖 Beginner Guide — How to Use This Tab')} icon="🎓" defaultOpen={true} color="neon-blue">
                        <div className="space-y-4">
                            {/* Step 1 */}
                            <div className="flex gap-3">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-neon-blue/10 border border-neon-blue/30 flex items-center justify-center text-neon-blue text-sm font-bold">1</div>
                                <div>
                                    <h4 className="font-bold text-white text-sm mb-1">{t('dnsGuide.step1Title', 'Choose Your Mode')}</h4>
                                    <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.step1Desc', 'Select "DNS Resolver Override" to test if your ISP is poisoning DNS queries, or "TLS Split-Stream" to fragment your TLS handshake and bypass DPI censorship.')}</p>
                                </div>
                            </div>
                            {/* Step 2 */}
                            <div className="flex gap-3">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-neon-blue/10 border border-neon-blue/30 flex items-center justify-center text-neon-blue text-sm font-bold">2</div>
                                <div>
                                    <h4 className="font-bold text-white text-sm mb-1">{t('dnsGuide.step2Title', 'Configure Your Settings')}</h4>
                                    <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.step2Desc', 'For DNS mode: Pick a DNS server from the dropdown (DoH recommended for censored regions). For TLS Split: Select your ISP preset or manually set fragment size and interval.')}</p>
                                </div>
                            </div>
                            {/* Step 3 */}
                            <div className="flex gap-3">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-neon-blue/10 border border-neon-blue/30 flex items-center justify-center text-neon-blue text-sm font-bold">3</div>
                                <div>
                                    <h4 className="font-bold text-white text-sm mb-1">{t('dnsGuide.step3Title', 'Select Browser Fingerprint')}</h4>
                                    <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.step3Desc', 'Choose a TLS fingerprint (Chrome recommended) so your traffic looks like normal browser activity to DPI systems.')}</p>
                                </div>
                            </div>
                            {/* Step 4 */}
                            <div className="flex gap-3">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-neon-blue/10 border border-neon-blue/30 flex items-center justify-center text-neon-blue text-sm font-bold">4</div>
                                <div>
                                    <h4 className="font-bold text-white text-sm mb-1">{t('dnsGuide.step4Title', 'Paste Your Config & Scan')}</h4>
                                    <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.step4Desc', 'Paste a working VLESS/Trojan config (vless://... or trojan://...) into the text box, then press Start Scanner. The app will launch Xray with your settings and test connectivity.')}</p>
                                </div>
                            </div>

                            <div className="mt-3 p-3 bg-neon-blue/5 border border-neon-blue/20 rounded-lg">
                                <p className="text-xs text-neon-blue font-bold">💡 {t('dnsGuide.proTip', 'Pro Tip')}</p>
                                <p className="text-xs text-gray-400 mt-1">{t('dnsGuide.proTipDesc', 'If you\'re in Iran, start with the "Iran MCI" or "Iran Irancell" preset and Chrome fingerprint. If it fails, try DoH (Google or Cloudflare) instead of plain DNS.')}</p>
                            </div>
                        </div>
                    </CollapsibleSection>

                    {/* ────────── TLS SPLIT-STREAM EXPLAINED ────────── */}
                    <CollapsibleSection title={t('dnsGuide.tlsTitle', '🔧 How TLS Split-Stream Works')} icon="⚡">
                        <div className="space-y-3">
                            <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.tlsP1', 'When you connect to a website over HTTPS, the very first message your computer sends is called the "TLS ClientHello". This message contains the SNI (Server Name Indication) — the hostname you\'re trying to visit (e.g., youtube.com).')}</p>
                            <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.tlsP2', 'Government firewalls read this SNI to decide whether to block your connection. TLS Split-Stream defeats this by splitting the ClientHello into tiny fragments. The firewall sees incomplete pieces and can\'t reconstruct the hostname.')}</p>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                                <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                                    <h5 className="text-xs font-bold text-neon-purple mb-1">🎯 tlshello</h5>
                                    <p className="text-[10px] text-gray-500">{t('dnsGuide.tlsHelloDesc', 'Splits ONLY the TLS ClientHello. Most effective and targeted. Use this first.')}</p>
                                </div>
                                <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                                    <h5 className="text-xs font-bold text-neon-blue mb-1">📦 1-3 Mode</h5>
                                    <p className="text-[10px] text-gray-500">{t('dnsGuide.mode13Desc', 'Splits the first 1-3 data writes. Broader but less targeted. Try if tlshello fails.')}</p>
                                </div>
                                <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                                    <h5 className="text-xs font-bold text-neon-purple mb-1">📏 Size & Interval</h5>
                                    <p className="text-[10px] text-gray-500">{t('dnsGuide.sizeIntervalDesc', 'Size = bytes per fragment (smaller = harder to detect). Interval = delay in ms between fragments.')}</p>
                                </div>
                            </div>
                        </div>
                    </CollapsibleSection>

                    {/* ────────── DNS RESOLVER OVERRIDE ────────── */}
                    <CollapsibleSection title={t('dnsGuide.dnsTitle', '🌐 How DNS Resolver Override Works')} icon="🧬">
                        <div className="space-y-3">
                            <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.dnsP1', 'When your ISP censors the internet, one of the first things they do is poison DNS queries. When you try to resolve "youtube.com", your ISP returns a fake IP address or blocks the response entirely.')}</p>
                            <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.dnsP2', 'DNS Resolver Override routes your Xray DNS queries through a different server — bypassing your ISP\'s poisoned DNS. You can use encrypted protocols like DoH (DNS-over-HTTPS) so your ISP can\'t even see what you\'re resolving.')}</p>

                            <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
                                <table className="w-full text-xs">
                                    <thead><tr className="bg-white/5"><th className="px-3 py-2 text-left text-gray-400 font-bold">{t('dnsGuide.dnsFormat', 'Format')}</th><th className="px-3 py-2 text-left text-gray-400 font-bold">{t('dnsGuide.dnsExample', 'Example')}</th><th className="px-3 py-2 text-left text-gray-400 font-bold">{t('dnsGuide.dnsSecurity', 'Security')}</th></tr></thead>
                                    <tbody className="text-gray-400">
                                        <tr className="border-t border-white/5"><td className="px-3 py-2 font-mono">UDP</td><td className="px-3 py-2 font-mono">8.8.8.8</td><td className="px-3 py-2">⚠️ {t('dnsGuide.dnsPlain', 'Unencrypted')}</td></tr>
                                        <tr className="border-t border-white/5"><td className="px-3 py-2 font-mono">TCP</td><td className="px-3 py-2 font-mono">tcp://8.8.8.8</td><td className="px-3 py-2">⚠️ {t('dnsGuide.dnsPlain', 'Unencrypted')}</td></tr>
                                        <tr className="border-t border-white/5"><td className="px-3 py-2 font-mono">DoT</td><td className="px-3 py-2 font-mono text-[10px]">tcp://1.1.1.1:853</td><td className="px-3 py-2">🔒 {t('dnsGuide.dnsEncrypted', 'Encrypted')}</td></tr>
                                        <tr className="border-t border-white/5"><td className="px-3 py-2 font-mono">DoH</td><td className="px-3 py-2 font-mono text-[10px]">https://dns.google/dns-query</td><td className="px-3 py-2">🔒 {t('dnsGuide.dnsEncrypted', 'Encrypted')}</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </CollapsibleSection>

                    {/* ────────── UTLS FINGERPRINT ────────── */}
                    <CollapsibleSection title={t('dnsGuide.utlsTitle', '🎭 What is uTLS Browser Fingerprint?')} icon="🔐">
                        <div className="space-y-3">
                            <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.utlsP1', 'Every program creates a unique "TLS fingerprint" when it connects to a server. Government DPI systems can detect that you\'re using Xray/V2Ray instead of a real browser by analyzing this fingerprint.')}</p>
                            <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.utlsP2', 'uTLS solves this by mimicking the exact TLS handshake of real browsers. When you select "Chrome", your Xray connection looks identical to Google Chrome to any observer.')}</p>
                            <div className="mt-2 p-3 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                                <p className="text-xs text-orange-400 font-bold">⚠️ {t('dnsGuide.utlsWarning', 'Important for Iranian Users')}</p>
                                <p className="text-xs text-gray-400 mt-1">{t('dnsGuide.utlsWarningDesc', 'Iranian ISPs (especially MCI and Irancell) actively detect non-browser TLS fingerprints. Always select Chrome or Firefox to avoid detection.')}</p>
                            </div>
                        </div>
                    </CollapsibleSection>

                    {/* ────────── ISP PRESETS ────────── */}
                    <CollapsibleSection title={t('dnsGuide.ispTitle', '🇮🇷 ISP-Specific Presets Explained')} icon="📡">
                        <div className="space-y-3">
                            <p className="text-xs text-gray-400 leading-relaxed">{t('dnsGuide.ispP1', 'Different ISPs use different DPI (Deep Packet Inspection) systems with varying detection capabilities. Fragment settings that work on one ISP may not work on another.')}</p>
                            <div className="space-y-2">
                                <div className="flex items-start gap-3 bg-black/40 p-3 rounded-lg border border-white/5">
                                    <span className="text-lg">🇮🇷</span>
                                    <div>
                                        <h5 className="text-xs font-bold text-red-400">MCI (Hamrah Aval)</h5>
                                        <p className="text-[10px] text-gray-500 mt-0.5">{t('dnsGuide.ispMci', 'Most aggressive DPI in Iran. Uses ML-based analysis. Needs large fragments (100-200 bytes) with moderate delays.')}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-black/40 p-3 rounded-lg border border-white/5">
                                    <span className="text-lg">🇮🇷</span>
                                    <div>
                                        <h5 className="text-xs font-bold text-yellow-400">Irancell (MTN)</h5>
                                        <p className="text-[10px] text-gray-500 mt-0.5">{t('dnsGuide.ispIrancell', 'Strong DPI but less aggressive than MCI. Medium fragments (50-100 bytes) usually work well.')}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-black/40 p-3 rounded-lg border border-white/5">
                                    <span className="text-lg">🇮🇷</span>
                                    <div>
                                        <h5 className="text-xs font-bold text-green-400">Shatel</h5>
                                        <p className="text-[10px] text-gray-500 mt-0.5">{t('dnsGuide.ispShatel', 'Lighter DPI. Small, fast fragments (10-30 bytes, 1-5ms delay) are very effective.')}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-black/40 p-3 rounded-lg border border-white/5">
                                    <span className="text-lg">🇨🇳</span>
                                    <div>
                                        <h5 className="text-xs font-bold text-blue-400">China GFW</h5>
                                        <p className="text-[10px] text-gray-500 mt-0.5">{t('dnsGuide.ispChina', 'Advanced stateful DPI. Medium fragments with longer delays (20-50ms) to avoid detection.')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CollapsibleSection>

                </div>
            )}
        </div>
    );
}
