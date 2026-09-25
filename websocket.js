import { WebSocketServer, WebSocket } from 'ws';
import jsonwebtoken from 'jsonwebtoken';
import url from 'url';

// storeId (string) -> Set<WebSocket>. Uma loja pode ter mais de uma conexão
// ao mesmo tempo (dashboard aberto em duas abas, por exemplo), por isso um
// Set em vez de uma única referência.
const storeSockets = new Map();

function registerStoreSocket(storeId, ws) {
  if (!storeSockets.has(storeId)) {
    storeSockets.set(storeId, new Set());
  }
  storeSockets.get(storeId).add(ws);
}

function unregisterStoreSocket(storeId, ws) {
  const sockets = storeSockets.get(storeId);
  if (!sockets) return;
  sockets.delete(ws);
  if (sockets.size === 0) {
    storeSockets.delete(storeId);
  }
}

// Envia um evento para todas as conexões abertas da loja informada.
// Não lança erro se a loja não estiver conectada no momento (dashboard
// fechado) — nesse caso simplesmente não há ninguém para notificar agora,
// a loja vê o estado atualizado na próxima vez que abrir/atualizar a tela.
export function notifyStore(storeId, event) {
  const sockets = storeSockets.get(String(storeId));
  if (!sockets || sockets.size === 0) return;

  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// Conexão autenticada por token de loja, passado via query string:
// ws(s)://<host>?token=<JWT_STORE>
// (mesmo token retornado no login REST da loja, POST /stores/login).
//
// Heartbeat (ping/pong): sem isso, uma conexão pode "morrer" silenciosamente
// — o proxy de borda do Render (ou de qualquer plataforma cloud) derruba
// conexões WebSocket ociosas depois de um tempo sem tráfego, mas o processo
// Node não fica sabendo: o socket, do lado daqui, continua com
// readyState === OPEN indefinidamente. notifyStore() então "envia" pra esse
// socket zumbi sem erro nenhum, e a loja nunca recebe o evento.
//
// O ping/pong resolve os dois lados do problema ao mesmo tempo: (1) o
// tráfego periódico do ping mantém o proxy enxergando a conexão como ativa,
// evitando o timeout por ociosidade; e (2) se o cliente não responder com
// pong dentro do próprio intervalo (sinal de que a conexão já está morta,
// mesmo que o Node ainda não tenha percebido), o servidor derruba
// (`terminate()`) e libera o socket — o que também já dispara o 'close'
// existente, removendo a loja de storeSockets.
const HEARTBEAT_INTERVAL_MS = Number(process.env.WS_HEARTBEAT_INTERVAL_MS) || 30000;

const websocket = (server, { heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS } = {}) => {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const { query } = url.parse(req.url, true);
    const token = query.token;

    if (!token) {
      ws.close(4001, 'Token ausente');
      return;
    }

    let storeId;
    try {
      const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET_STORE);
      storeId = String(decoded.storeId);
    } catch (error) {
      ws.close(4001, 'Token inválido');
      return;
    }

    ws.storeId = storeId;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    registerStoreSocket(storeId, ws);

    ws.on('close', () => {
      unregisterStoreSocket(storeId, ws);
    });

    ws.on('error', () => {
      unregisterStoreSocket(storeId, ws);
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        // Não respondeu ao ping do ciclo anterior — considera morta.
        // terminate() (não close()) força o encerramento imediato da
        // conexão TCP subjacente, sem esperar um handshake que uma conexão
        // já zumbi nunca vai completar; isso também dispara o 'close'
        // acima, cuidando de tirar a loja de storeSockets.
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, heartbeatIntervalMs);

  // Amarrado ao close do HTTP server (não ao de wss, que não se fecha
  // sozinho quando o server fecha) — assim o heartbeat não fica rodando
  // indefinidamente depois que o servidor para (relevante sobretudo nos
  // testes, que sobem/derrubam um server por describe/it).
  server.on('close', () => clearInterval(heartbeat));

  return wss;
};

export default websocket;