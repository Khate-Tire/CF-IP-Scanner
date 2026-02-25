/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';

function CollapsibleSection({ title, icon, color, children, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="border border-white/5 rounded-xl overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between p-4 bg-black/30 hover:bg-black/50 transition-colors text-left rtl:text-right"
            >
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className={color}>{icon}</span> {title}
                </h3>
                <span className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {open && <div className="p-5 bg-black/20 border-t border-white/5">{children}</div>}
        </section>
    );
}

export default function AboutBox() {
    const { t } = useTranslation();
    const steps = t('about.guide.steps');
    const features = t('about.features');
    const tips = t('about.tips.list');
    const faqItems = t('about.faq.items');
    const privacyItems = t('about.privacy.items');
    const cards = t('about.whatIs.cards');

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="glass-panel p-8 neon-border shadow-[0_0_20px_rgba(0,243,255,0.1)]">
                {/* Header */}
                <div className="text-center mb-8 pb-6 border-b border-white/10">
                    <img src={new URL('/logo.png', import.meta.url).href} alt="Logo" className="w-16 h-16 mx-auto mb-4 rounded-full drop-shadow-[0_0_15px_rgba(0,243,255,0.5)]" />
                    <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-purple">
                        {t('about.title')}
                    </h2>
                    <p className="text-gray-400 mt-2 text-sm">{t('about.subtitle')}</p>
                    <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-neon-blue/10 border border-neon-blue/30 text-neon-blue text-xs font-mono">
                        v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'} • {t('about.openSource', 'Open Source')}
                    </div>
                </div>

                <div className="space-y-4 text-gray-300">

                    {/* What is this */}
                    <CollapsibleSection title={t('about.whatIs.title')} icon="🚀" color="text-neon-blue" defaultOpen={true}>
                        <p className="leading-relaxed mb-4">{t('about.whatIs.p1')}</p>
                        <p className="leading-relaxed mb-4">{t('about.whatIs.p2')}</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                            {[
                                { ...cards.ping, icon: "📡" },
                                { ...cards.speed, icon: "⚡" },
                                { ...cards.tls, icon: "🔒" },
                                { ...cards.proto, icon: "🌐" }
                            ].map((f, i) => (
                                <div key={i} className="bg-black/40 p-3 rounded-lg border border-white/5 text-center">
                                    <div className="text-2xl mb-1">{f.icon}</div>
                                    <div className="text-xs font-bold text-white">{f.label}</div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">{f.val}</div>
                                </div>
                            ))}
                        </div>
                    </CollapsibleSection>

                    {/* Quick Start Guide */}
                    <CollapsibleSection title={t('about.guide.title')} icon="📖" color="text-neon-purple" defaultOpen={true}>
                        <div className="space-y-4">
                            {['s1', 's2', 's3', 's4', 's5'].map((key, i) => {
                                const s = steps[key];
                                return (
                                    <div key={i} className="flex gap-4">
                                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-neon-blue to-neon-purple flex items-center justify-center text-black font-black text-lg shadow-[0_0_10px_rgba(0,243,255,0.3)]">
                                            {i + 1}
                                        </div>
                                        <div className="flex-1">
                                            <h4 className="font-bold text-white mb-1">{s.title}</h4>
                                            <p className="text-sm text-gray-400 mb-2">{s.desc}</p>
                                            {s.sub && s.sub.length > 0 && (
                                                <ul className="space-y-1">
                                                    {s.sub.map((item, j) => (
                                                        <li key={j} className="text-sm text-gray-400 flex items-start gap-2">
                                                            <span className="text-neon-blue mt-1 text-xs">▸</span>
                                                            <span>{item}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CollapsibleSection>

                    {/* Advanced Features */}
                    <CollapsibleSection title={features.title} icon="🛡️" color="text-orange-400">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {['tcp', 'queue', 'tls', 'dpi', 'dnstt', 'dns_override', 'sni', 'fastly', 'warp', 'map', 'retry', 'macos'].map((key) => (
                                <div key={key} className="bg-black/40 p-4 rounded-lg border border-white/5">
                                    <h4 className="font-bold text-white mb-1">{features[key].title}</h4>
                                    <p className="text-sm text-gray-400">{features[key].desc}</p>
                                </div>
                            ))}
                        </div>
                    </CollapsibleSection>

                    {/* Tips */}
                    <CollapsibleSection title={t('about.tips.title')} icon="💡" color="text-green-400">
                        <ul className="space-y-3">
                            {Array.isArray(tips) && tips.map((tip, i) => (
                                <li key={i} className="flex items-start gap-3 text-sm text-gray-400">
                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center text-green-400 text-xs font-bold">{i + 1}</span>
                                    <span>{tip}</span>
                                </li>
                            ))}
                        </ul>
                    </CollapsibleSection>

                    {/* FAQ */}
                    <CollapsibleSection title={t('about.faq.title')} icon="❓" color="text-cyan-400">
                        <div className="space-y-4">
                            {Array.isArray(faqItems) && faqItems.map((faq, i) => (
                                <div key={i} className="bg-black/30 rounded-lg p-4">
                                    <h4 className="font-bold text-white text-sm mb-2">Q: {faq.q}</h4>
                                    <p className="text-sm text-gray-400">{faq.a}</p>
                                </div>
                            ))}
                        </div>
                    </CollapsibleSection>

                    {/* System Requirements */}
                    <CollapsibleSection title={t('about.sysReq.title')} icon="💻" color="text-gray-300">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {['min', 'rec'].map(key => {
                                const req = t(`about.sysReq.${key}`);
                                return (
                                    <div key={key} className="bg-black/40 p-4 rounded-lg border border-white/5">
                                        <h4 className="font-bold text-white mb-2">{req.title}</h4>
                                        <ul className="space-y-1 text-sm text-gray-400">
                                            {Array.isArray(req.items) && req.items.map((item, i) => (
                                                <li key={i}>• {item}</li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                        </div>
                    </CollapsibleSection>

                    {/* Privacy */}
                    <CollapsibleSection title={t('about.privacy.title')} icon="🔐" color="text-red-400">
                        <div className="space-y-3 text-sm text-gray-400">
                            {Array.isArray(privacyItems) && privacyItems.map((item, i) => (
                                <p key={i}>• <strong className="text-white">{item}</strong></p>
                            ))}
                        </div>
                    </CollapsibleSection>

                    {/* Developer & Community */}
                    <section className="mt-6 pt-6 border-t border-white/10">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="bg-black/40 p-6 rounded-lg border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 rtl:right-auto rtl:left-0 w-32 h-32 bg-neon-blue/10 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-neon-blue/20"></div>
                                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                    <span className="text-neon-blue">👨‍💻</span> {t('about.author')}
                                </h3>
                                <div className="space-y-3 relative z-10">
                                    <p className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-teal-400">Khate Tire</p>
                                    <div className="flex items-center gap-3 text-sm text-gray-300"><span className="w-6 text-center">✉️</span><a href="mailto:khatetire@proton.me" className="hover:text-neon-blue transition-colors">khatetire@proton.me</a></div>
                                    <div className="flex items-center gap-3 text-sm text-gray-300"><span className="w-6 text-center">🐙</span><a href="https://github.com/Khate-Tire" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">github.com/Khate-Tire</a></div>
                                    <div className="flex items-center gap-3 text-sm text-gray-300"><span className="w-6 text-center">✈️</span><a href="https://t.me/hossein_shiravani" target="_blank" rel="noreferrer" className="hover:text-neon-blue transition-colors">@hossein_shiravani</a></div>
                                    <div className="flex items-center gap-3 text-sm text-gray-300"><span className="w-6 text-center">🆔</span><a href="https://orcid.org/0000-0002-9517-9773" target="_blank" rel="noreferrer" className="hover:text-green-400 transition-colors">ORCID: 0000-0002-9517-9773</a></div>
                                </div>
                            </div>

                            <div className="bg-black/40 p-6 rounded-lg border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 rtl:right-auto rtl:left-0 w-32 h-32 bg-neon-purple/10 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-neon-purple/20"></div>
                                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                    <span className="text-neon-purple">🌟</span> {t('about.community')}
                                </h3>
                                <div className="space-y-4 relative z-10">
                                    <a href="https://github.com/Khate-Tire/CF-IP-Scanner" target="_blank" rel="noreferrer" className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-all group/btn">
                                        <div className="flex items-center gap-3"><span className="text-xl">⭐</span><div><p className="text-sm font-bold text-white group-hover/btn:text-yellow-400 transition-colors">{t('about.starGithub')}</p><p className="text-xs text-gray-400">{t('about.supportProject')}</p></div></div>
                                        <span className="text-gray-500 group-hover/btn:text-white">→</span>
                                    </a>
                                    <a href="https://t.me/antigravity_ip_bot" target="_blank" rel="noreferrer" className="flex items-center justify-between p-3 bg-neon-blue/5 hover:bg-neon-blue/10 border border-neon-blue/20 rounded transition-all group/btn">
                                        <div className="flex items-center gap-3"><span className="text-xl">🤖</span><div><p className="text-sm font-bold text-neon-blue">{t('about.freeBot')}</p><p className="text-xs text-gray-400">{t('about.getBotConfigs')}</p></div></div>
                                        <span className="text-neon-blue opacity-50 group-hover/btn:opacity-100">→</span>
                                    </a>
                                    <a href="https://t.me/ANTIGRAVITY_IP" target="_blank" rel="noreferrer" className="flex items-center justify-between p-3 bg-neon-purple/5 hover:bg-neon-purple/10 border border-neon-purple/20 rounded transition-all group/btn">
                                        <div className="flex items-center gap-3"><span className="text-xl">💬</span><div><p className="text-sm font-bold text-neon-purple">{t('about.joinTelegram')}</p><p className="text-xs text-gray-400">{t('about.shareFeedback')}</p></div></div>
                                        <span className="text-neon-purple opacity-50 group-hover/btn:opacity-100">→</span>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Footer */}
                    <div className="mt-8 pt-6 border-t border-white/10 text-center text-sm text-gray-500">
                        <p className="mb-2">{t('about.footer')}</p>
                        <p className="text-xs text-gray-600">{t('about.copyright')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
