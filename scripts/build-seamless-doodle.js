// scripts/build-seamless-doodle.js
// Generates a mathematically seamless 320x320 SVG pattern tile for Telegram-style wallpapers
const fs = require('fs');
const path = require('path');

const TILE_SIZE = 320;

// Individual doodle definitions (relative viewBox 0 0 24 24)
const ICONS = {
  heart: `<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>`,
  airplane: `<path d="M2.5 11.5l19-8-8 19-3-7.5-8-3.5zm8 3.5l5.5-7.5"/>`,
  coffee: `<path d="M4 19h14a2 2 0 0 0 2-2v-5H4v5a2 2 0 0 0 2 2zm14-5h2a2 2 0 0 1 0 4h-2M7 5c0 2 2 2 2 4M11 5c0 2 2 2 2 4M15 5c0 2 2 2 2 4M3 21h18"/>`,
  camera: `<path d="M4 7h4l2-3h4l2 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><circle cx="12" cy="14" r="4"/>`,
  star: `<path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/>`,
  sparkle: `<path d="M12 3v18M3 12h18M6 6l12 12M6 18L18 6"/>`,
  music: `<path d="M9 18V5l12-2v13M9 9l12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
  glasses: `<path d="M6 4l3 6v6m-3 0h6M18 4l-3 6v6m-3 0h6M7 6h10"/>`,
  rings: `<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/><path d="M9 7l1-2h4l1 2"/>`,
  moon: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
  envelope: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>`,
  gift: `<rect x="4" y="9" width="16" height="12" rx="1"/><rect x="2" y="6" width="20" height="3" rx="1"/><line x1="12" y1="6" x2="12" y2="21"/><path d="M12 6C10 3 6 4 8 6h4zm0 0c2-3 6-4 4 6h-4z"/>`,
  cloud: `<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>`,
  planet: `<circle cx="12" cy="12" r="6"/><path d="M3 15c4-2 14-6 18-2M3 13c3 3 13 5 18 1"/>`,
  cat: `<path d="M12 5c-3 0-5 2-5 5v5a5 5 0 0 0 10 0v-5c0-3-2-5-5-5zM8 7L6 3l3 2M16 7l2-4-3 2"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="11" r="1"/>`,
  leaf: `<path d="M12 2C6 2 2 6 2 12c0 6 6 10 10 10 6 0 10-4 10-10 0-6-4-10-10-10zm0 20c-5 0-9-4-9-9 0-3 2-6 5-8 3-2 7-3 9-3 0 5-2 9-5 12z"/>`
};

// Placement layout: { type, x, y, scale, rotate }
const PLACEMENTS = [
  { type: 'heart', x: 30, y: 35, scale: 0.9, rotate: -12 },
  { type: 'airplane', x: 110, y: 40, scale: 0.95, rotate: 18 },
  { type: 'sparkle', x: 190, y: 30, scale: 0.7, rotate: 0 },
  { type: 'coffee', x: 270, y: 45, scale: 0.85, rotate: -8 },
  
  { type: 'camera', x: 60, y: 105, scale: 0.85, rotate: 10 },
  { type: 'star', x: 145, y: 95, scale: 0.75, rotate: 15 },
  { type: 'rings', x: 220, y: 110, scale: 0.8, rotate: -5 },
  { type: 'cloud', x: 305, y: 115, scale: 0.85, rotate: 6 },

  { type: 'planet', x: 25, y: 185, scale: 0.8, rotate: 22 },
  { type: 'envelope', x: 105, y: 175, scale: 0.9, rotate: -15 },
  { type: 'cat', x: 185, y: 180, scale: 0.85, rotate: 4 },
  { type: 'music', x: 265, y: 170, scale: 0.8, rotate: 12 },

  { type: 'glasses', x: 45, y: 260, scale: 0.8, rotate: -8 },
  { type: 'leaf', x: 125, y: 255, scale: 0.75, rotate: 25 },
  { type: 'moon', x: 205, y: 265, scale: 0.85, rotate: -18 },
  { type: 'gift', x: 285, y: 250, scale: 0.8, rotate: 10 },

  // Filler sparks & dots
  { type: 'sparkle', x: 75, y: 55, scale: 0.5, rotate: 45 },
  { type: 'star', x: 235, y: 55, scale: 0.5, rotate: 0 },
  { type: 'sparkle', x: 165, y: 140, scale: 0.55, rotate: 30 },
  { type: 'heart', x: 20, y: 135, scale: 0.55, rotate: 15 },
  { type: 'star', x: 300, y: 195, scale: 0.5, rotate: 15 },
  { type: 'sparkle', x: 80, y: 215, scale: 0.5, rotate: 0 },
  { type: 'heart', x: 160, y: 220, scale: 0.6, rotate: -10 },
  { type: 'sparkle', x: 245, y: 215, scale: 0.5, rotate: 45 }
];

function generateWrappedSvg() {
  let elements = [];

  for (const p of PLACEMENTS) {
    const rawSvg = ICONS[p.type];
    if (!rawSvg) continue;

    // Check if item needs wrapping across 320x320 boundaries
    const margin = 26;
    const offsetsX = [0];
    const offsetsY = [0];

    if (p.x < margin) offsetsX.push(TILE_SIZE);
    if (p.x > TILE_SIZE - margin) offsetsX.push(-TILE_SIZE);
    if (p.y < margin) offsetsY.push(TILE_SIZE);
    if (p.y > TILE_SIZE - margin) offsetsY.push(-TILE_SIZE);

    for (const dx of offsetsX) {
      for (const dy of offsetsY) {
        const posX = p.x + dx;
        const posY = p.y + dy;
        elements.push(`
          <g transform="translate(${posX.toFixed(1)}, ${posY.toFixed(1)}) rotate(${p.rotate}) scale(${p.scale}) translate(-12, -12)">
            ${rawSvg}
          </g>
        `);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    ${elements.join('')}
  </svg>`;
}

const svgContent = generateWrappedSvg();
const outPath = path.resolve(__dirname, '../public/na-dvoih-original/assets/tg-seamless-pattern.svg');
fs.writeFileSync(outPath, svgContent, 'utf8');
console.log('Seamless SVG Pattern generated successfully at:', outPath, 'Length:', svgContent.length);
