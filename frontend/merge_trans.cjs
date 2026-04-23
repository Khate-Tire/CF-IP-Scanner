const fs = require('fs');
const file = process.argv[2];
const inputFile = process.argv[3];

if (!fs.existsSync(file) || !fs.existsSync(inputFile)) {
    console.error("Missing files");
    process.exit(1);
}

const targetObj = JSON.parse(fs.readFileSync(file, 'utf8'));
const transObj = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

function mergeTrans(target, source) {
    for (let k in source) {
        if (typeof source[k] === 'object' && source[k] !== null) {
            if (!target[k]) target[k] = {};
            mergeTrans(target[k], source[k]);
        } else {
            target[k] = source[k];
        }
    }
}

mergeTrans(targetObj, transObj);
fs.writeFileSync(file, JSON.stringify(targetObj, null, 2), 'utf8');
console.log(`Updated ${file}`);
