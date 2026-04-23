const fs = require('fs');
const glob = require('glob');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const i18nDir = path.join(srcDir, 'i18n');
const enPath = path.join(i18nDir, 'en.json');

const files = glob.sync(`${srcDir}/**/*.jsx`);

let en = {};
if (fs.existsSync(enPath)) {
    en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
}

const updateNested = (obj, keyPath, value) => {
    const keys = keyPath.split('.');
    let curr = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!curr[keys[i]]) curr[keys[i]] = {};
        curr = curr[keys[i]];
    }
    const lastKey = keys[keys.length - 1];
    if (curr[lastKey] === undefined || curr[lastKey] === '') {
        curr[lastKey] = value;
    }
};

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    
    // Match t('key.path', 'Default value') or t("key.path", "Default value")
    const regex1 = /t\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = regex1.exec(content)) !== null) {
        updateNested(en, match[1], match[2]);
    }

    // Match t('key.path', { ... }, 'Default value')
    const regex2 = /t\(\s*['"]([^'"]+)['"]\s*,\s*\{[^\}]+\}\s*,\s*(['"`])(.*?)\2\s*\)/g;
    while ((match = regex2.exec(content)) !== null) {
        updateNested(en, match[1], match[3]);
    }
});

// Update en.json
fs.writeFileSync(enPath, JSON.stringify(en, null, 2));

// Update other languages with same keys if missing
const langs = ['fa', 'ru', 'zh', 'tr', 'ar'];
langs.forEach(lang => {
    const langPath = path.join(i18nDir, `${lang}.json`);
    let langObj = {};
    if (fs.existsSync(langPath)) {
        langObj = JSON.parse(fs.readFileSync(langPath, 'utf8'));
    }
    
    // Copy missing keys from en to langObj
    const copyMissing = (target, source) => {
        for (const key in source) {
            if (typeof source[key] === 'object' && source[key] !== null) {
                if (!target[key]) target[key] = {};
                copyMissing(target[key], source[key]);
            } else {
                if (target[key] === undefined) {
                    target[key] = source[key]; // Fallback to EN
                }
            }
        }
    };
    
    copyMissing(langObj, en);
    fs.writeFileSync(langPath, JSON.stringify(langObj, null, 2));
});

console.log("Extraction complete!");
