const { spawnSync } = require('child_process');

const jsCode = `(() => {
  const sendBtn = Array.from(document.querySelectorAll('button')).find(b => {
    const aria = b.getAttribute('aria-label') || '';
    return aria.includes('Отправить') || aria.includes('Send');
  });
  if (!sendBtn) return 'NO_SEND_BTN';
  
  sendBtn.focus();
  sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  sendBtn.click();
  return 'CLICKED_SEND_ARIA_' + sendBtn.getAttribute('aria-label');
})()`;

const res = spawnSync('bsk', ['evaluate', '--session', 'bneg', jsCode], { encoding: 'utf-8' });
console.log('Result:', res.stdout);
console.log('Stderr:', res.stderr);
