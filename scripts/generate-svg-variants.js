const fs = require('fs');

const rawSvg = fs.readFileSync('public/na-dvoih-original/assets/tg-seamless-pattern.svg', 'utf8');

const lightSvg = rawSvg.replace('stroke="currentColor"', 'stroke="#1f2d24" opacity="0.065"');
fs.writeFileSync('public/na-dvoih-original/assets/tg-seamless-pattern-light.svg', lightSvg);

const darkSvg = rawSvg.replace('stroke="currentColor"', 'stroke="#ffffff" opacity="0.055"');
fs.writeFileSync('public/na-dvoih-original/assets/tg-seamless-pattern-dark.svg', darkSvg);

console.log('SVGs written successfully!');
