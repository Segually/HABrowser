import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { TRUSTED_IP, FRIEND_PORT, FrameDecoder, DestinationPolicy, validateClientPacket } from './protocol.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.data': 'application/octet-stream' };

export function createServer({ publicDir = path.join(projectRoot, 'public'), dial = options => net.createConnection(options), diagnostic = () => {} } = {}) {
  const sessions = new Map(), peers = new Map();
  const root = path.resolve(publicDir);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/relay') { res.writeHead(426); res.end('WebSocket required'); return; }
      const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = await realpath(path.resolve(root, '.' + name));
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || name.split('/').some(part => part.startsWith('.'))) throw new Error('Forbidden path');
      const info = await stat(file);
      if (!info.isFile()) throw new Error('Not a file');
      let contentFile = file;
      if (file.endsWith('.br')) { res.setHeader('Content-Encoding', 'br'); contentFile = file.slice(0, -3); }
      else if (file.endsWith('.gz')) { res.setHeader('Content-Encoding', 'gzip'); contentFile = file.slice(0, -3); }
      res.setHeader('Content-Type', MIME[path.extname(contentFile)] || 'application/octet-stream');
      res.setHeader('Content-Length', info.size);
      res.writeHead(200);
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      // Origin prevents another website from using this relay through a victim browser.
      const origin = new URL(req.headers.origin);
      const key = req.socket.remoteAddress;
      if (url.pathname !== '/api/relay' || url.search || origin.host !== req.headers.host ||
          !['http:', 'https:'].includes(origin.protocol) || wss.clients.size >= 256 || (peers.get(key) || 0) >= 32) throw new Error('Denied');
      wss.handleUpgrade(req, socket, head, ws => {
        peers.set(key, (peers.get(key) || 0) + 1);
        ws.once('close', () => { const n = peers.get(key) - 1; if (n) peers.set(key, n); else peers.delete(key); });
        wss.emit('connection', ws, req);
      });
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  wss.on('connection', (ws, req) => {
    let tcp, session, role, ready = false, selected = false;
    const children = new Set();
    const helloTimeout = setTimeout(() => fail('Handshake timeout'), 5000);
    let connectTimeout;
    function fail(reason) {
      diagnostic({ event: 'relay-failed', role, reason });
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: reason }));
      ws.close(1008, reason); tcp?.destroy();
    }
    ws.on('error', () => tcp?.destroy());
    ws.on('close', () => {
      clearTimeout(helloTimeout); clearTimeout(connectTimeout); tcp?.destroy();
      if (role === 'friend' && session) {
        sessions.delete(session.token);
        for (const child of session.children) child.close(1008, 'Friend session ended');
      } else session?.children.delete(ws);
    });
    const outbound = new FrameDecoder(packet => {
      validateClientPacket(role, packet);
      if (role === 'friend') session.policy.observeClient(packet);
    });
    let inbound;
    ws.on('message', (bytes, binary) => {
      try {
        if (!selected) {
          if (binary || bytes.length > 1024) throw new Error('Expected handshake');
          const hello = JSON.parse(bytes.toString());
          role = hello.role;
          let port, host;
          if (role === 'friend') {
            if (hello.ip !== TRUSTED_IP || hello.port !== FRIEND_PORT) throw new Error('Friend destination denied');
            session = { token: randomBytes(32).toString('hex'), policy: new DestinationPolicy(Date.now, diagnostic), owner: ws, peer: req.socket.remoteAddress, children };
            sessions.set(session.token, session); port = FRIEND_PORT; host = TRUSTED_IP;
          } else {
            session = sessions.get(hello.session);
            if (!session || session.owner.readyState !== WebSocket.OPEN || session.peer !== req.socket.remoteAddress ||
                session.children.size >= 16 || !session.policy.consume(role, hello.ip, hello.port)) throw new Error('Destination not authorized');
            session.children.add(ws); port = hello.port; host = hello.ip;
          }
          selected = true; clearTimeout(helloTimeout);
          // Non-friend destinations must exactly match a consumed upstream grant.
          tcp = dial({ host, port, family: 4 });
          diagnostic({ event: 'tcp-connect', role, ip: host, port });
          connectTimeout = setTimeout(() => fail('TCP connection timeout'), 8000);
          tcp.setNoDelay(true); tcp.setTimeout(role === 'ping' ? 8000 : 120000);
          inbound = new FrameDecoder(packet => { if (role === 'friend') session.policy.observe(packet); });
          tcp.on('connect', () => {
            clearTimeout(connectTimeout); ready = true;
            ws.send(JSON.stringify({ type: 'ready', session: role === 'friend' ? session.token : undefined }));
          });
          tcp.on('data', data => {
            try {
              // Inspect trusted responses before forwarding them, so join grants exist first.
              const frames = inbound.push(data);
              for (const frame of frames) {
                if (ws.readyState !== WebSocket.OPEN) return;
                if (ws.bufferedAmount + frame.length > LIMIT) throw new Error('Browser backpressure limit');
                ws.send(frame, { binary: true });
              }
            } catch (error) { diagnostic({ event: 'upstream-rejected', role, reason: error.message }); fail('Invalid upstream protocol or slow browser'); }
          });
          tcp.on('timeout', () => fail('TCP idle timeout'));
          tcp.on('error', error => { diagnostic({ event: 'tcp-error', role, code: error.code }); fail('Upstream unavailable'); });
          tcp.on('close', () => ws.close(1000, 'TCP closed'));
          return;
        }
        if (!ready || !binary) throw new Error('Expected connected binary transport');
        const frames = outbound.push(bytes);
        for (const frame of frames) {
          if (tcp.writableLength + frame.length > LIMIT) throw new Error('TCP backpressure limit');
          tcp.write(frame);
        }
      } catch (error) { fail(error.message.slice(0, 100)); }
    });
  });
  let timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.alive === false) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 30000);
  timer.unref();
  wss.on('connection', ws => { ws.alive = true; ws.on('pong', () => { ws.alive = true; }); });
  server.on('close', () => { clearInterval(timer); for (const ws of wss.clients) ws.terminate(); wss.close(); });
  return { server, wss };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8001);
  const host = process.env.HOST || '127.0.0.1';
  const { server } = createServer({ diagnostic: event => console.log(JSON.stringify({ time: new Date().toISOString(), ...event })) });
  server.listen(port, host, () => console.log(`WorkingServer: http://${host}:${port} (upstream ${TRUSTED_IP}:${FRIEND_PORT})`));
}
