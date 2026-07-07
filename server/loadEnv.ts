// Dev-only convenience: load key=value pairs from server/.env (gitignored) into
// process.env so local secrets like GROQ_API_KEY work without exporting them in the
// shell. Node 18 has no built-in --env-file / loadEnvFile, and we avoid a dependency.
// Existing env vars always win, so in prod (HF Space) the injected secrets take
// precedence and the absent .env is simply skipped. Import this FIRST, for its side effect.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
