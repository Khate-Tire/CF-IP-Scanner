import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import en from './en.json';
import fa from './fa.json';
import ru from './ru.json';

const locales = { en, fa, ru };

const RTL_LANGUAGES = ['fa', 'ar', 'he'];

export const LANGUAGES = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'fa', name: 'فارسی', flag: '🇮🇷' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' }
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
