mergeInto(LibraryManager.library, {
  $HARelay: { next: 1, session: '', sessionOwner: 0, connections: {} },
  HA_RelayOpen__deps: ['$HARelay'],
  HA_RelayOpen: function(role, ip, port) {
    var id = HARelay.next++;
    var entry = { state: 1, queue: [], queuedBytes: 0, socket: null };
    HARelay.connections[id] = entry;
    var roles = ['friend', 'game', 'ping'];
    var kind = roles[role];
    if (!kind || (kind !== 'friend' && !HARelay.session)) { entry.state = 4; return id; }
    try {
      var target = UTF8ToString(ip);
      var socket = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/api/relay');
      entry.socket = socket;
      socket.binaryType = 'arraybuffer';
      socket.onopen = function() {
        socket.send(JSON.stringify({ role: kind, ip: target, port: port, session: kind === 'friend' ? undefined : HARelay.session }));
      };
      socket.onmessage = function(event) {
        if (typeof event.data === 'string') {
          try {
            var control = JSON.parse(event.data);
            if (control.type === 'ready' && entry.state === 1) {
              if (kind === 'friend') { HARelay.session = control.session; HARelay.sessionOwner = id; }
              entry.state = 2;
            } else if (control.type === 'error') { entry.state = 4; socket.close(); }
            else { entry.state = 4; socket.close(); }
          } catch (error) { entry.state = 4; socket.close(); }
          return;
        }
        if (entry.state !== 2 || entry.queuedBytes + event.data.byteLength > 1024 * 1024) {
          entry.state = 4; socket.close(); return;
        }
        var bytes = new Uint8Array(event.data);
        entry.queue.push(bytes);
        entry.queuedBytes += bytes.length;
      };
      socket.onerror = function() { entry.state = 4; };
      socket.onclose = function() {
        if (entry.state !== 4) entry.state = 3;
        if (HARelay.sessionOwner === id) { HARelay.session = ''; HARelay.sessionOwner = 0; }
      };
    } catch (error) { entry.state = 4; }
    return id;
  },
  HA_RelayState__deps: ['$HARelay'],
  HA_RelayState: function(id) { var entry = HARelay.connections[id]; return entry ? entry.state : 3; },
  HA_RelayReceiveSize__deps: ['$HARelay'],
  HA_RelayReceiveSize: function(id) {
    var entry = HARelay.connections[id];
    return entry && entry.queue.length ? entry.queue[0].length : 0;
  },
  HA_RelayReceive__deps: ['$HARelay'],
  HA_RelayReceive: function(id, pointer, length) {
    var entry = HARelay.connections[id];
    if (!entry || !entry.queue.length || entry.queue[0].length !== length) return 0;
    var bytes = entry.queue.shift();
    HEAPU8.set(bytes, pointer);
    entry.queuedBytes -= length;
    return length;
  },
  HA_RelaySend__deps: ['$HARelay'],
  HA_RelaySend: function(id, pointer, length) {
    var entry = HARelay.connections[id];
    if (!entry || entry.state !== 2 || entry.socket.readyState !== WebSocket.OPEN) return 0;
    if (entry.socket.bufferedAmount + length > 1024 * 1024) { entry.state = 4; entry.socket.close(); return 0; }
    try { entry.socket.send(HEAPU8.slice(pointer, pointer + length)); return length; }
    catch (error) { entry.state = 4; return 0; }
  },
  HA_RelayClose__deps: ['$HARelay'],
  HA_RelayClose: function(id) {
    var entry = HARelay.connections[id];
    if (!entry) return;
    if (entry.socket) { entry.socket.onopen = null; entry.socket.onmessage = null; entry.socket.onclose = null; entry.socket.onerror = function() {}; entry.socket.close(); }
    entry.queue.length = 0;
    if (HARelay.sessionOwner === id) { HARelay.session = ''; HARelay.sessionOwner = 0; }
    delete HARelay.connections[id];
  }
});
