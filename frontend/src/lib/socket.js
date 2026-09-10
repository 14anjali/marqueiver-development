import { io } from 'socket.io-client';
import { auth } from './api';

/**
 * The client for the Socket.io gateway.
 *
 * The server has implemented `deal:join`, `message:new`, `typing` and
 * `notification:new` since the messaging module was written. Nothing ever
 * connected to it: `socket.io-client` was not a dependency, and MessagesPage
 * was fetch-only. So "live chat" meant reloading the page, and the whole
 * gateway was dead weight in the deploy.
 *
 * One shared connection for the whole app, because Socket.io multiplexes rooms
 * over a single transport — a socket per page would multiply handshakes,
 * re-authenticate on every navigation, and drop the notification room each
 * time the user left Messages.
 */

const URL = import.meta.env.VITE_API_URL || undefined; // same-origin in dev

let socket = null;

/**
 * Connect, or return the existing connection.
 *
 * The access token is read at call time rather than captured, so a connection
 * made after a token refresh uses the new one. Returns null when there is no
 * session — an unauthenticated socket would just be rejected by the handshake.
 */
export function getSocket() {
  if (!auth.token) return null;

  if (socket?.connected || socket?.active) return socket;

  socket = io(URL, {
    auth: { token: auth.token },
    // The gateway authenticates the handshake, so a failed auth is permanent
    // until the token changes. Reconnecting forever against a rejected token
    // is a busy loop; `reconnectSocket` is what a new token calls instead.
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    // Long-poll first, upgrade to websocket. Proxies that block websockets
    // otherwise leave the user with no realtime at all rather than a slower
    // version of it.
    transports: ['polling', 'websocket'],
    withCredentials: true,
  });

  return socket;
}

/**
 * Drop and rebuild the connection with the current token.
 *
 * Call after a token refresh or a login: the handshake auth is evaluated once,
 * when the socket connects, so an existing socket keeps using the token it was
 * opened with until it is replaced.
 */
export function reconnectSocket() {
  disconnectSocket();
  return getSocket();
}

/** Close the connection and forget it. Call on logout. */
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/**
 * Subscribe to an event for as long as the caller is mounted.
 *
 * Returns an unsubscribe function, so a React effect can `return on(...)`
 * directly. Removing the exact handler rather than all handlers for the event
 * matters once two components listen to the same event — a bare `off('x')` in
 * one component's cleanup would silently deafen the other.
 */
export function on(event, handler) {
  const s = getSocket();
  if (!s) return () => {};
  s.on(event, handler);
  return () => s.off(event, handler);
}

/**
 * Join a deal's chat room and stay joined across reconnects.
 *
 * The server verifies membership and messaging state before honouring a join,
 * answering `deal:join:ok` or `deal:join:denied` — so the room is not assumed,
 * it is granted. `onDenied` receives the reason (`FORBIDDEN`, `MESSAGING_LOCKED`,
 * `NOT_FOUND`) so the UI can explain rather than silently showing nothing.
 *
 * The join is re-issued on `connect` because a reconnected socket is a new
 * socket server-side and has no rooms.
 */
export function joinDeal(dealId, { onJoined, onDenied } = {}) {
  const s = getSocket();
  if (!s || !dealId) return () => {};

  const join = () => s.emit('deal:join', dealId);

  const handleOk = (p) => { if (p?.dealId === dealId) onJoined?.(p); };
  const handleDenied = (p) => { if (p?.dealId === dealId) onDenied?.(p.reason, p); };

  s.on('connect', join);
  s.on('deal:join:ok', handleOk);
  s.on('deal:join:denied', handleDenied);

  if (s.connected) join();

  return () => {
    s.emit('deal:leave', dealId);
    s.off('connect', join);
    s.off('deal:join:ok', handleOk);
    s.off('deal:join:denied', handleDenied);
  };
}

/** Tell the room this user is typing. Ignored server-side unless joined. */
export function emitTyping(dealId) {
  const s = getSocket();
  if (s?.connected && dealId) s.emit('typing', dealId);
}
