const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const bskPath = 'C:\\Users\\Геннадий\\.local\\bin\\bsk.exe';
const promptFile = path.join(__dirname, 'argon-prompt.txt');
const text = fs.readFileSync(promptFile, 'utf8');

console.log('Sending prompt to Gemini Argon in session alwr...');

// Fill @e5
const fillRes = spawnSync(bskPath, ['fill', '--ref', '@e5', '--value', text, '--session', 'alwr'], {
  encoding: 'utf8'
});
console.log('Fill stdout:', fillRes.stdout);
console.log('Fill stderr:', fillRes.stderr);

// Observe to find send button
const obsRes = spawnSync(bskPath, ['observe', '--session', 'alwr'], { encoding: 'utf8' });
console.log('Observe output snippet:\n', obsRes.stdout.slice(0, 1000));

// Find the send button ref from observe
const sendMatch = obsRes.stdout.match(/(@e\d+)\s+button\s+"Отправить сообщение"/);
if (sendMatch) {
  const btnRef = sendMatch[1];
  console.log('Found send button:', btnRef, '-> Clicking...');
  const clickRes = spawnSync(bskPath, ['click', btnRef, '--session', 'alwr'], { encoding: 'utf8' });
  console.log('Click result:', clickRes.stdout, clickRes.stderr);
} else {
  console.log('Send button not found in observe output');
}
