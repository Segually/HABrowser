# WorkingServer

Node 20+ server for the WebGL game and `/api/relay` WebSocket transport.

```sh
npm ci
npm run sync-game
npm start
```

Open http://localhost:8001/. Static content lives in `public/`. Generated game files
and `node_modules` are excluded from Git. `sync-game` copies `../Builds/HA_WASM`
by default; another build directory can be passed after `--`.

The friend upstream is fixed in source to `45.8.201.48:7002`. The relay reads the
original framed/fragmented TCP protocol and UTF-16LE `Packet.cs` fields. Only
trusted upstream command 37 can grant a game connection: the exact advertised
public IPv4 address and signed-short port must match, and the single-use grant
expires after 30 seconds. Public join requests (30) must name a server from the
latest trusted server list (29); its join response must match that requested name.
The list or a client request alone never authorizes a TCP connection. Login/dispatcher
responses (11/32) separately grant restricted ping connections for 60 seconds.
Pings can only send command 33. Client packets never create destination grants.
Each grant belongs to its live friend connection; another browser session cannot
reuse it. Closing the friend connection revokes its grants and child connections.

The client uses `ws://` or `wss://` on its current page host. Serve the game through
this Node server; the older Python static server does not implement the relay.
`HOST` defaults to `127.0.0.1`, `PORT` to `8001`. For deployment, use an HTTPS
reverse proxy that preserves `Host` and upgrades `/api/relay`; set `HOST` as needed.
WebSocket origins must match the request host. Frame/message/connection limits,
timeouts, and bounded write buffers protect the relay from unbounded buffering.

This server enforces connection destinations; the original game server continues
to validate gameplay and account/join credentials. Friend connections and dispatcher
pings stay pinned to `45.8.201.48`. Game connections use their trusted advertised
endpoint unchanged; hostnames and local/private-network addresses are rejected.
