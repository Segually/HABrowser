export const TRUSTED_IP = '45.8.201.48';
export const FRIEND_PORT = 7002;
export const MAX_FRAME = 8192;
const MAX_PACKET = 1024 * 1024;

// Connection.cs outer frames and ReceiveQueue.cs four fragmented priority streams.
export class FrameDecoder {
  constructor(onPacket) {
    this.onPacket = onPacket;
    this.pending = Buffer.alloc(0);
    this.streams = Array.from({ length: 4 }, () => null);
  }
  push(bytes) {
    this.pending = Buffer.concat([this.pending, bytes]);
    if (this.pending.length > 128 * 1024) throw new Error('Frame buffer limit');
    const frames = [];
    while (this.pending.length >= 2) {
      const length = this.pending.readInt16LE(0);
      if (length < 10 || length > MAX_FRAME) throw new Error('Invalid frame length');
      if (this.pending.length < length) break;
      const frame = this.pending.subarray(0, length);
      this.decode(frame);
      frames.push(frame);
      this.pending = this.pending.subarray(length);
    }
    return frames;
  }
  decode(frame) {
    const count = frame[2];
    if (count < 1 || count > 4) throw new Error('Invalid stream count');
    const seen = new Set();
    let offset = 3;
    for (let i = 0; i < count; i++) {
      if (offset + 6 > frame.length) throw new Error('Truncated stream');
      const id = frame[offset++], status = frame[offset++];
      const length = frame.readInt32LE(offset); offset += 4;
      if (id > 3 || status > 3 || seen.has(id) || length < 1 || offset + length > frame.length)
        throw new Error('Invalid stream');
      seen.add(id);
      if (status === 2 || status === 3) this.streams[id] = { parts: [], length: 0 };
      const stream = this.streams[id];
      if (!stream) throw new Error('Unexpected continuation');
      stream.length += length;
      if (stream.length > MAX_PACKET) throw new Error('Packet buffer limit');
      stream.parts.push(Buffer.from(frame.subarray(offset, offset + length)));
      offset += length;
      if (status === 0 || status === 3) {
        this.onPacket(Buffer.concat(stream.parts, stream.length));
        this.streams[id] = null;
      }
    }
    if (offset !== frame.length) throw new Error('Trailing frame data');
  }
}

export class PacketReader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  need(length) { if (this.offset + length > this.bytes.length) throw new Error('Truncated packet'); }
  byte() { this.need(1); return this.bytes[this.offset++]; }
  short() { this.need(2); const n = this.bytes.readInt16LE(this.offset); this.offset += 2; return n; }
  string() {
    const length = this.short();
    if (length < 0 || length % 2) throw new Error('Invalid UTF-16 string');
    this.need(length);
    const value = this.bytes.toString('utf16le', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  count() { const n = this.short(); if (n < 0 || n > 512) throw new Error('Invalid list count'); return n; }
  end() { if (this.offset !== this.bytes.length) throw new Error('Trailing packet data'); }
}

function dispatchers(reader) {
  const entries = [];
  const count = reader.count();
  for (let i = 0; i < count; i++) entries.push({ name: reader.string(), ip: reader.string(), port: reader.short() });
  return entries;
}

export class DestinationPolicy {
  constructor(now = Date.now, diagnostic = () => {}) { this.now = now; this.diagnostic = diagnostic; this.grants = new Map(); }
  observe(packet) {
    const reader = new PacketReader(packet);
    const command = reader.byte();
    let entries = [], role;
    if (command === 37) {
      reader.string(); // server name
      reader.string(); // join code remains on the original wire protocol
      const ip = reader.string(), type = reader.string(), port = reader.short();
      reader.byte(); reader.end();
      // A newer join response supersedes every previous game destination.
      for (const key of this.grants.keys()) if (key.startsWith('game:')) this.grants.delete(key);
      this.diagnostic({ event: 'join-advertised', ip, port, addressType: type });
      // Match Connection.cs: only the literal "ipv6" selects IPv6; other hints
      // use IPv4. The exact numeric IP/port checks below remain authoritative.
      if (type === 'ipv6') return;
      entries = [{ ip, port }]; role = 'game';
    } else if (command === 32) {
      reader.byte(); entries = dispatchers(reader); reader.end(); role = 'ping';
    } else if (command === 11) {
      const result = reader.byte();
      if (result !== 1 && result !== 2) return;
      let count = reader.count();
      for (let i = 0; i < count; i++) {
        reader.string(); reader.string();
        if (reader.byte() === 1) { reader.byte(); reader.string(); reader.short(); }
        else if (reader.byte() === 1) reader.string();
      }
      for (let list = 0; list < 2; list++) {
        count = reader.count();
        for (let i = 0; i < count; i++) { reader.string(); reader.string(); }
      }
      entries = dispatchers(reader); role = 'ping';
      reader.short(); reader.byte(); reader.short();
      count = reader.count();
      for (let i = 0; i < count; i++) for (let field = 0; field < 6; field++) reader.string();
      reader.end();
    } else return;
    // Only this fixed IP can ever become eligible, even if upstream advertises another.
    for (const entry of entries) {
      this.diagnostic({ event: 'destination-advertised', role, ip: entry.ip, port: entry.port, allowed: entry.ip === TRUSTED_IP });
      if (entry.ip !== TRUSTED_IP || !Number.isInteger(entry.port) || entry.port < 1 || entry.port > 32767) continue;
      if (this.grants.size >= 64) this.grants.delete(this.grants.keys().next().value);
      this.grants.set(`${role}:${entry.ip}:${entry.port}`, this.now() + (role === 'game' ? 30000 : 60000));
    }
  }
  consume(role, ip, port) {
    if (ip !== TRUSTED_IP || !Number.isInteger(port) || !['game', 'ping'].includes(role)) return false;
    const key = `${role}:${ip}:${port}`, expiry = this.grants.get(key);
    if (!expiry || expiry <= this.now()) { this.grants.delete(key); return false; }
    this.grants.delete(key);
    return true;
  }
}

const PLAYER_COMMANDS = new Set([1, 7, 8, 10, 11, 15, 16, 18, 20, 24, 26, 29, 30, 31, 32, 39, 41, 42, 43, 44, 45, 46, 53, 56, 59]);
export function validateClientPacket(role, packet) {
  if (role === 'friend' && !PLAYER_COMMANDS.has(packet[0])) throw new Error('Not a player command');
  if (role === 'ping' && (packet.length !== 1 || packet[0] !== 33)) throw new Error('Only dispatcher pings allowed');
}
