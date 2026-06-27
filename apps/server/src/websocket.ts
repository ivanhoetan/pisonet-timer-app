import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { WsEvents } from '@pisonet/shared';
import { Computer } from './models/Computer';
import { sessionEngine } from './services/sessionEngine';

export function setupWebSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  sessionEngine.setIo(io);

  io.on('connection', (socket: Socket) => {
    void handleConnection(socket, io);
  });

  return io;
}

async function handleConnection(socket: Socket, io: Server): Promise<void> {
  const { computerId, authSecret } = socket.handshake.auth as {
    computerId?: string;
    authSecret?: string;
  };

  if (!computerId || !authSecret) {
    socket.emit('error', { message: 'Missing computer credentials' });
    socket.disconnect(true);
    return;
  }

  const computer = await Computer.findById(computerId);
  if (!computer || computer.authSecret !== authSecret) {
    socket.emit('error', { message: 'Invalid computer credentials' });
    socket.disconnect(true);
    return;
  }

  const room = `computer:${computerId}`;
  await socket.join(room);

  await Computer.findByIdAndUpdate(computerId, {
    status: 'ONLINE',
    lastOnline: new Date(),
  });

  io.to(room).emit(WsEvents.COMPUTER_STATUS, {
    computerId,
    status: 'ONLINE',
  });

  sessionEngine.resyncComputer(computerId);

  socket.on(WsEvents.HEARTBEAT, () => {
    void Computer.findByIdAndUpdate(computerId, { lastOnline: new Date() });
    socket.emit(WsEvents.HEARTBEAT, { ok: true, at: new Date().toISOString() });
  });

  socket.on('disconnect', () => {
    void Computer.findByIdAndUpdate(computerId, { status: 'OFFLINE' });
    io.to(room).emit(WsEvents.COMPUTER_STATUS, {
      computerId,
      status: 'OFFLINE',
    });
  });
}
