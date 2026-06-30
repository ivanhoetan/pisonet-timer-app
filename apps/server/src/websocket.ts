import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { WsEvents, ComputerStatus } from '@pisonet/shared';
import { Computer } from './models/Computer';
import { sessionEngine } from './services/sessionEngine';

// Decide a computer's status when its client (re)connects. Admin-controlled
// states are sticky; a PC with a live session stays IN_USE; otherwise ONLINE.
function resolveConnectedStatus(
  current: ComputerStatus,
  computerId: string
): ComputerStatus {
  if (current === ComputerStatus.LOCKED || current === ComputerStatus.MAINTENANCE) {
    return current;
  }
  if (sessionEngine.getByComputerId(computerId)) {
    return ComputerStatus.IN_USE;
  }
  return ComputerStatus.ONLINE;
}

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

  // Don't clobber the real status on (re)connect. A client reconnect must not
  // reset an in-use PC to plain ONLINE, and must never clear an admin-controlled
  // LOCKED/MAINTENANCE state.
  const onConnectStatus = resolveConnectedStatus(computer.status, computerId);
  await Computer.findByIdAndUpdate(computerId, {
    status: onConnectStatus,
    lastOnline: new Date(),
  });

  io.to(room).emit(WsEvents.COMPUTER_STATUS, {
    computerId,
    status: onConnectStatus,
  });

  sessionEngine.resyncComputer(computerId);

  socket.on(WsEvents.HEARTBEAT, () => {
    void Computer.findByIdAndUpdate(computerId, { lastOnline: new Date() });
    socket.emit(WsEvents.HEARTBEAT, { ok: true, at: new Date().toISOString() });
  });

  socket.on('disconnect', () => {
    // Preserve LOCKED/MAINTENANCE, and keep an active paid session marked IN_USE
    // (its time keeps counting server-side); only an idle PC goes OFFLINE.
    void (async () => {
      const current = await Computer.findById(computerId).select('status').lean();
      const status = current?.status;
      if (status === 'LOCKED' || status === 'MAINTENANCE') return;
      if (sessionEngine.getByComputerId(computerId)) return;

      await Computer.findByIdAndUpdate(computerId, { status: 'OFFLINE' });
      io.to(room).emit(WsEvents.COMPUTER_STATUS, {
        computerId,
        status: 'OFFLINE',
      });
    })();
  });
}
