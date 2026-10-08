import { appendFile, mkdir } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

export function clientIP(req, trustProxy = false) {
  const peer = req.socket.remoteAddress;
  if (trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
    const forwarded = req.headers['x-real-ip'];
    if (typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  }
  return peer;
}

// A single ordered queue avoids interleaved records. Only selected metadata is
// logged by callers; passwords, login codes, tokens and packet bodies stay out.
export function createActivityLogger({ enabled = false, directory }) {
  let pending = Promise.resolve();
  return {
    log(event) {
      if (!enabled) return;
      const time = new Date().toISOString();
      const record = JSON.stringify({ ...event, time }) + '\n';
      pending = pending.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await appendFile(path.join(directory, `activity-${time.slice(0, 10)}.jsonl`), record, { mode: 0o600 });
      }).catch(error => console.error(`Activity logging failed: ${error.code || error.message}`));
    },
    flush() { return pending; }
  };
}
