/* Copyright (c) 2026 Khate Tire */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import en from './en.json';
import fa from './fa.json';
import ru from './ru.json';
import zh from './zh.json';
import tr from './tr.json';
import ar from './ar.json';

const locales = { en, fa, ru, zh, tr, ar };

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

const FlagZH = () => (
    <svg viewBox="0 0 30 20" width="20" height="10" className="rounded-sm inline-block">
        <rect width="30" height="20" fill="#de2910" />
        <path fill="#ffde00" d="M5 2.5l1.5 4.5h4.8l-3.9 2.8 1.5 4.7-3.9-2.8-3.9 2.8 1.5-4.7-3.9-2.8h4.8z" />
    </svg>
);

const FlagTR = () => (
    <svg viewBox="0 0 30 20" width="20" height="10" className="rounded-sm inline-block">
        <rect width="30" height="20" fill="#E30A17" />
        <circle cx="12" cy="10" r="5" fill="#fff" />
        <circle cx="13.5" cy="10" r="4" fill="#E30A17" />
        <polygon fill="#fff" points="16,8.5 17.5,10 16,11.5 18,10.5 19.5,12 18.5,10 20,8.5 18,9.5" />
    </svg>
);

const FlagAR = () => (
    <svg viewBox="0 0 30 20" width="20" height="10" className="rounded-sm inline-block">
        <rect width="30" height="6.6" fill="#007a3d" />
        <rect y="6.6" width="30" height="6.6" fill="#fff" />
        <rect y="13.2" width="30" height="6.8" fill="#000" />
        <rect width="8" height="20" fill="#ce1126" />
    </svg>
);

export const LANGUAGES = [
    { code: 'en', name: 'English', flag: 'EN', Flag: FlagGB },
    { code: 'fa', name: 'فارسی', flag: 'FA', Flag: FlagIR },
    { code: 'ru', name: 'Русский', flag: 'RU', Flag: FlagRU },
    { code: 'zh', name: '中文 (简体)', flag: 'ZH', Flag: FlagZH },
    { code: 'tr', name: 'Türkçe', flag: 'TR', Flag: FlagTR },
    { code: 'ar', name: 'العربية', flag: 'AR', Flag: FlagAR }
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

    const normalizeValue = useCallback((value) => {
        if (Array.isArray(value)) return value.map(normalizeValue);
        if (!value || typeof value !== 'object') return value;
        const keys = Object.keys(value);
        if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
            return keys
                .map(k => Number(k))
                .sort((a, b) => a - b)
                .map(i => normalizeValue(value[String(i)]));
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = normalizeValue(v);
        return out;
    }, []);

    // Nested key resolver: t("app.title") => locales[lang].app.title
    // Supports both:
    // - t(key, { replacements })
    // - t(key, "Default text", { replacements })
    const t = useCallback((key, arg2, arg3) => {
        let defaultText;
        let replacements;
        if (typeof arg2 === 'string') {
            defaultText = arg2;
            replacements = arg3;
        } else {
            replacements = arg2;
        }

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
                        return defaultText ?? key; // Key not found anywhere
                    }
                }
                val = fallback;
                break;
            }
        }
        val = normalizeValue(val);
        // Handle replacement tokens like {count}
        if (typeof val === 'string' && replacements) {
            return Object.entries(replacements).reduce(
                (str, [k, v]) => str.replace(`{${k}}`, v), val
            );
        }
        return val;
    }, [strings, normalizeValue]);

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
