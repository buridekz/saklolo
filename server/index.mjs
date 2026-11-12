import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.mjs';
mkdirSync('data', { recursive: true });
let io;
const { app, close } = createApp({ database: 'data/saklolo.sqlite', apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime', notify: () => io?.emit('reports:changed') });
const server = createServer(app);
io = new Server(server);
server.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1', () => console.log('Saklolo backend ready on port ' + (process.env.PORT || 3001) + ' (local demo, no agency connected).'));
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  io.close(() => { close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
