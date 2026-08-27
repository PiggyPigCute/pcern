const { WebSocketServer } = require('ws');
const auth = require('./auth');

let wss = null;

function attach(server) {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, callback) => {
      callback(Boolean(auth.currentUser(info.req)));
    },
  });
}

function broadcast(type, payload) {
  if (!wss) return;
  const data = JSON.stringify({ type, ...payload });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

module.exports = { attach, broadcast };
