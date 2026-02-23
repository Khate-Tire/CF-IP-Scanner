/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import en from './en.json';
import fa from './fa.json';
import ru from './ru.json';

const locales = { en, fa, ru };

const RTL_LANGUAGES = ['fa', 'ar', 'he'];

// Inline SVG flags that work on all platforms (including Windows Electron)
const FlagGB = () => (
    <svg viewBox="0 0 60 30" width="20" height="10" className="rounded-sm inline-block">
        <clipPath id="gb"><path d="M0 0v30h60V0z" /></clipPath>
        <g clipPath="url(#gb)">
            <path d="M0 0v30h60V0z" fill="#012169" />
            <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6" />
            <path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" strokeWidth="4" clipPath="url(#gb)" />
            <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
            <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
        </g>
    </svg>
);

const FlagIR = () => (
    <svg viewBox="0 0 21 12" width="20" height="10" className="rounded-sm inline-block">
        <rect width="21" height="4" fill="#239f40" />
        <rect y="4" width="21" height="4" fill="#fff" />
        <rect y="8" width="21" height="4" fill="#da0000" />
    </svg>
);

const FlagRU = () => (
    <svg viewBox="0 0 21 12" width="20" height="10" className="rounded-sm inline-block">
        <rect width="21" height="4" fill="#fff" />
        <rect y="4" width="21" height="4" fill="#0039a6" />
        <rect y="8" width="21" height="4" fill="#d52b1e" />
    </svg>
);

export const LANGUAGES = [
    { code: 'en', name: 'English', flag: 'EN', Flag: FlagGB },
    { code: 'fa', name: 'فارسی', flag: 'FA', Flag: FlagIR },
    { code: 'ru', name: 'Русский', flag: 'RU', Flag: FlagRU }
];

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
    const [lang, setLang] = useState(() => {
        try { return localStorage.getItem('app-lang') || 'en'; }
        catch { return 'en'; }
    });

    const isRtl = RTL_LANGUAGES.includes(lang);
    const strings = locales[lang] || locales.en;

    useEffect(() => {
        try { localStorage.setItem('app-lang', lang); } catch { }
        document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
        document.documentElement.lang = lang;
    }, [lang, isRtl]);

    // Nested key resolver: t("app.title") => locales[lang].app.title
    const t = useCallback((key, replacements) => {
        const keys = key.split('.');
        let val = strings;
        for (const k of keys) {
            if (val && typeof val === 'object' && k in val) {
                val = val[k];
            } else {
                // Fallback to English
                let fallback = locales.en;
                for (const fk of keys) {
                    if (fallback && typeof fallback === 'object' && fk in fallback) {
                        fallback = fallback[fk];
                    } else {
                        return key; // Key not found anywhere
                    }
                }
                val = fallback;
                break;
            }
        }
        // Handle replacement tokens like {count}
        if (typeof val === 'string' && replacements) {
            return Object.entries(replacements).reduce(
                (str, [k, v]) => str.replace(`{${k}}`, v), val
            );
        }
        return val;
    }, [strings]);

    return (
        <LanguageContext.Provider value={{ lang, setLang, t, isRtl }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useTranslation() {
    const ctx = useContext(LanguageContext);
    if (!ctx) throw new Error('useTranslation must be used within LanguageProvider');
    return ctx;
}
