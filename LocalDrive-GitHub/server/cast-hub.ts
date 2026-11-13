import { randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

type Role = 'viewer' | 'sender';
type Room = {
  code: string;
  token: string;
  expiresAt: number;
  viewer?: WebSocket;
  sender?: WebSocket;
  timer: NodeJS.Timeout;
};

export class CastHub {
  private readonly rooms = new Map<string, Room>();
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  createSession() {
    const code = String(randomInt(10_000_000, 100_000_000));
    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + 3 * 60 * 1000;
    const timer = setTimeout(() => this.closeRoom(code), expiresAt - Date.now());
    timer.unref();
    this.rooms.set(code, { code, token, expiresAt, timer });
    return { code, token, expiresAt };
  }

  closeSession(token: string): boolean {
    const room = [...this.rooms.values()].find((candidate) => candidate.token === token);
    if (!room) return false;
    this.closeRoom(room.code);
    return true;
  }

  attach(server: Server): void {
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_500_000, perMessageDeflate: false });
    server.on('upgrade', (request, socket, head) => {
      let url: URL;
      try { url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`); }
      catch { socket.destroy(); return; }
      if (url.pathname !== '/api/cast/ws') { socket.destroy(); return; }
      const role = url.searchParams.get('role');
      if (role !== 'viewer' && role !== 'sender') { this.reject(socket); return; }
      if (this.isBlocked(request)) { this.reject(socket); return; }
      const room = role === 'viewer'
        ? [...this.rooms.values()].find((candidate) => candidate.token === url.searchParams.get('token'))
        : this.rooms.get(url.searchParams.get('code') || '');
      if (!room || room.expiresAt <= Date.now()) { this.recordFailure(request); this.reject(socket); return; }
      this.attempts.delete(request.socket.remoteAddress || 'unknown');
      sockets.handleUpgrade(request, socket, head, (client) => this.connect(client, room, role));
    });
  }

  private isBlocked(request: IncomingMessage): boolean {
    const address = request.socket.remoteAddress || 'unknown';
    const attempt = this.attempts.get(address);
    return Boolean(attempt && attempt.resetAt > Date.now() && attempt.count >= 8);
  }

  private recordFailure(request: IncomingMessage): void {
    const address = request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = this.attempts.get(address);
    if (!attempt || attempt.resetAt <= now) {
      this.attempts.set(address, { count: 1, resetAt: now + 5 * 60 * 1000 });
      return;
    }
    attempt.count = Math.min(8, attempt.count + 1);
  }

  private reject(socket: Duplex): void {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
  }

  private connect(socket: WebSocket, room: Room, role: Role): void {
    const key = role === 'viewer' ? 'viewer' : 'sender';
    room[key]?.close(4001, 'Replaced by a new connection.');
    room[key] = socket;
    socket.send(JSON.stringify({ type: room[role === 'viewer' ? 'sender' : 'viewer'] ? 'peer-connected' : 'waiting' }));
    if (role === 'sender') room.viewer?.send(JSON.stringify({ type: 'peer-connected' }));

    socket.on('message', (message, isBinary) => {
      if (!isBinary) return;
      const size = Buffer.isBuffer(message) ? message.byteLength : Array.isArray(message) ? message.reduce((total, part) => total + part.byteLength, 0) : message.byteLength;
      if (role !== 'sender' || size > 1_500_000) {
        socket.close(1008, 'Invalid stream data.');
        return;
      }
      const viewer = room.viewer;
      if (viewer?.readyState === WebSocket.OPEN && viewer.bufferedAmount < 1_000_000) viewer.send(message, { binary: true });
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      if (room[key] === socket) delete room[key];
      const peer = room[role === 'viewer' ? 'sender' : 'viewer'];
      if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: 'peer-disconnected' }));
    });
  }

  private closeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    clearTimeout(room.timer);
    room.viewer?.close(4002, 'Pairing code expired.');
    room.sender?.close(4002, 'Pairing code expired.');
    this.rooms.delete(code);
  }
}