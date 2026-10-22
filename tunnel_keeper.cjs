const { tunnelmole } = require('tunnelmole');
const fs = require('fs');
const path = require('path');

async function main() {
  try {
    console.log('[tunnel] Starting Tunnelmole on port 3000...');
    const url = await tunnelmole({ port: 3000 });
    console.log('[tunnel] ACTIVE_URL: ' + url);
    fs.writeFileSync(path.join(__dirname, 'active_tunnel_url.txt'), url, 'utf8');
    
    // Heartbeat to keep process and event loop alive permanently
    setInterval(() => {
      // noop
    }, 1000 * 60);
  } catch (err) {
    console.error('[tunnel] Error:', err);
    process.exit(1);
  }
}

main();
