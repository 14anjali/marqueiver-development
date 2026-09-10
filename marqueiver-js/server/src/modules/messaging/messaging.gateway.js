import { Server as IOServer } from 'socket.io';
import { verifyAccess } from '../../utils/tokens.js';
import { registerNotificationEmitter } from '../notifications/notifications.service.js';
import { Deal } from '../../models/index.js';
import { MESSAGING_ALLOWED_STATES } from './messaging.policy.js';
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
        /**
         * Scope §13/§18 — joining a deal room was previously unauthorized: any
         * authenticated socket could join `deal:<anyId>` and receive the live
         * message stream for a deal it was not part of, bypassing the REST
         * checks entirely. Membership and messaging state are now verified
         * server-side before the join is honoured.
         */
        socket.on('deal:join', async (dealId) => {
            try {
                const deal = await Deal.findById(dealId).select('brand creator state').lean();
                if (!deal) return socket.emit('deal:join:denied', { dealId, reason: 'NOT_FOUND' });

                const isParty = [deal.brand.toString(), deal.creator.toString()].includes(userId);
                if (!isParty && socket.data.role !== 'admin')
                    return socket.emit('deal:join:denied', { dealId, reason: 'FORBIDDEN' });

                if (socket.data.role !== 'admin' && !MESSAGING_ALLOWED_STATES.has(deal.state))
                    return socket.emit('deal:join:denied', { dealId, reason: 'MESSAGING_LOCKED' });

                socket.join(`deal:${dealId}`);
                socket.emit('deal:join:ok', { dealId });
            } catch {
                socket.emit('deal:join:denied', { dealId, reason: 'ERROR' });
            }
        });
        socket.on('deal:leave', (dealId) => socket.leave(`deal:${dealId}`));
        // Typing only reaches a room the socket was actually allowed to join.
        socket.on('typing', (dealId) => {
            if (socket.rooms.has(`deal:${dealId}`))
                socket.to(`deal:${dealId}`).emit('typing', { userId, dealId });
        });
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
