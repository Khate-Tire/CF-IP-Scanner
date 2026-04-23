const fs = require('fs');
const path = require('path');

const i18nDir = path.join(__dirname, 'src', 'i18n');
const en = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json'), 'utf8'));

const langs = ['fa', 'ru', 'zh', 'tr', 'ar'];

const getUntranslated = (enObj, langObj, path = '') => {
    let untranslated = {};
    for (const key in enObj) {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof enObj[key] === 'object' && enObj[key] !== null) {
            const nested = getUntranslated(enObj[key], langObj?.[key] || {}, currentPath);
            if (Object.keys(nested).length > 0) {
                untranslated[key] = nested;
            }
        } else {
            // It's untranslated if it's missing or exactly the same as English
            // (Assuming the value is actual English text. If the English text is a short code, this might false-positive, but our en.json has full English text)
            if (langObj?.[key] === undefined || langObj?.[key] === enObj[key]) {
                untranslated[key] = enObj[key];
            }
        }
    }
    return untranslated;
};

langs.forEach(lang => {
    const langObj = JSON.parse(fs.readFileSync(path.join(i18nDir, `${lang}.json`), 'utf8'));
    const untranslated = getUntranslated(en, langObj);
    fs.writeFileSync(path.join(__dirname, `untranslated_${lang}.json`), JSON.stringify(untranslated, null, 2));
    console.log(`Lang ${lang}: ${JSON.stringify(untranslated).length} chars of untranslated text`);
});
