/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation, LANGUAGES } from '../i18n/LanguageContext';

export default function LanguageSwitcher() {
    const { lang, setLang } = useTranslation();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    const current = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];

    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div ref={ref} className="relative inline-block">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:border-neon-blue/50 text-xs text-gray-300 hover:text-white transition-all"
            >
                <current.Flag />
                <span className="text-[10px] font-black tracking-wider bg-neon-blue/20 text-neon-blue px-1.5 py-0.5 rounded">{current.flag}</span>
                <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </button>

            {open && (
                <div className="absolute top-full mt-1 right-0 rtl:right-auto rtl:left-0 bg-[#0a0a14]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-[0_0_20px_rgba(0,243,255,0.1)] overflow-hidden z-50 min-w-[140px]">
                    {LANGUAGES.map(l => (
                        <button
                            key={l.code}
                            onClick={() => { setLang(l.code); setOpen(false); }}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs hover:bg-white/10 transition-colors ${l.code === lang ? 'text-neon-blue bg-neon-blue/10' : 'text-gray-300'
                                }`}
                        >
                            <l.Flag />
                            <span className="text-[10px] font-black tracking-wider bg-white/10 px-1.5 py-0.5 rounded">{l.flag}</span>
                            <span className="font-medium">{l.name}</span>
                            {l.code === lang && <span className="ml-auto text-neon-blue">✓</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
