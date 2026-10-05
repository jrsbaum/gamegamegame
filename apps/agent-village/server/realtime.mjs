import { WebSocket, WebSocketServer } from 'ws';

const cookieValue = (request, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`).exec(request.headers.cookie ?? '')?.[1];
};

const send = (client, payload) => {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
};

/** Attach the same-origin realtime channel used by the village UI. */
export function attachVillageWebSocket(server, village, { path = '/ws', cookieName = 'agent_village_session', publicOrigin } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const clients = new Map();
  const unsubscribe = village.subscribe(() => {
    // Every viewer gets the same public world update, while snapshot() still
    // records that viewer's own presence timestamp.
    for (const [viewerId, members] of clients) {
      const payload = { type: 'snapshot', snapshot: village.snapshot(viewerId) };
      for (const client of members) send(client, payload);
    }
  });

  const reject = (socket, status = '401 Unauthorized') => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  const onUpgrade = (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== path) return;
    if (request.headers.origin && request.headers.origin !== publicOrigin) { reject(socket, '403 Forbidden'); return; }
    let account;
    try { account = village.authenticate(cookieValue(request, cookieName)); } catch { reject(socket); return; }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, account.id));
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (client, ownerId) => {
    const members = clients.get(ownerId) ?? new Set();
    members.add(client); clients.set(ownerId, members);
    send(client, { type: 'hello', snapshot: village.snapshot(ownerId) });
    client.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { send(client, { type: 'error', code: 'invalid_json' }); return; }
      if (message?.type === 'snapshot.get') send(client, { type: 'snapshot', snapshot: village.snapshot(ownerId) });
      else send(client, { type: 'error', code: 'unsupported_message' });
    });
    client.on('close', () => {
      members.delete(client);
      if (!members.size) clients.delete(ownerId);
    });
    client.on('error', () => client.close());
  });

  const close = async () => {
    unsubscribe();
    server.off('upgrade', onUpgrade);
    for (const members of clients.values()) for (const client of members) client.close();
    clients.clear();
    await new Promise(resolve => wss.close(() => resolve()));
  };
  return { close };
}
