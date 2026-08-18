import { Server as IOServer } from 'socket.io';
import { verifyAccess } from '../../utils/tokens.js';
import { registerNotificationEmitter } from '../notifications/notifications.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
/**
 * Socket.io realtime layer (proposal §6). Chat is scoped to a deal room; each user
 * also joins a personal room for notification pushes. JWT-authenticated handshake.
 */
let io = null;
export function initSocket(httpServer) {
    io = new IOServer(httpServer, { cors: { origin: env.clientUrl, credentials: true } });
    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            const claims = verifyAccess(token);
            socket.data.userId = claims.sub;
            socket.data.role = claims.role;
            next();
        }
        catch {
            next(new Error('unauthorized'));
        }
    });
    io.on('connection', (socket) => {
        const userId = socket.data.userId;
        socket.join(`user:${userId}`);
        socket.on('deal:join', (dealId) => socket.join(`deal:${dealId}`));
        socket.on('deal:leave', (dealId) => socket.leave(`deal:${dealId}`));
        socket.on('typing', (dealId) => socket.to(`deal:${dealId}`).emit('typing', { userId, dealId }));
    });
    // Route in-app notifications to the user's personal room.
    registerNotificationEmitter((uid, notification) => {
        io?.to(`user:${uid}`).emit('notification:new', notification);
    });
    logger.info('🔌 Socket.io initialised (chat + live deal status)');
}
export function emitToDeal(dealId, event, payload) {
    io?.to(`deal:${dealId}`).emit(event, payload);
}
