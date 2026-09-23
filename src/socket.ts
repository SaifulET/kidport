import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { Server as SocketServer } from 'socket.io';
import { env } from './config/env';
import { User, type IUser } from './modules/users/user.model';
import { SupportIssue } from './modules/support/support-issue.model';
import { SupportMessage } from './modules/support/support-message.model';

type AccessPayload = { sub: string; type: 'access' };

type SupportMessageLike = {
  _id: unknown;
  userId: unknown;
  sender: 'user' | 'support';
  text: string;
  status: 'sent' | 'read';
  createdAt?: Date;
};

type SupportIssueLike = {
  _id: unknown;
  userId: unknown;
  title: string;
  description: string;
  urgency: string;
  status: string;
  attachments?: Array<{ originalName?: string | null; url?: string | null }>;
  updatedAt?: Date;
};

let io: SocketServer | null = null;

const adminRoom = 'support:admins';
const supportUserRoom = (userId: string) => `support:user:${userId}`;

const idString = (value: unknown) => {
  if (value && typeof value === 'object' && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const messageForUser = (message: SupportMessageLike) => ({
  id: idString(message._id),
  sender: message.sender,
  text: message.text,
  sentAt: message.createdAt,
  status: message.status
});

const messageForAdmin = (message: SupportMessageLike) => ({
  id: idString(message._id),
  sender: message.sender === 'support' ? 'agent' : 'parent',
  senderName: message.sender === 'support' ? 'Support Team' : 'Parent',
  text: message.text,
  time: message.createdAt
});

const ticketForAdmin = (issue: SupportIssueLike, user: IUser) => ({
  id: idString(issue._id),
  userId: idString(issue.userId),
  title: issue.title,
  description: issue.description,
  urgency: issue.urgency,
  status: issue.status,
  parentName: user.fullName,
  parentEmail: user.email,
  parentInitials: initials(user.fullName),
  lastActivity: issue.updatedAt,
  attachment: issue.attachments?.[0]?.originalName ?? issue.attachments?.[0]?.url ?? null,
  messageCount: 0
});

const ticketTitleFromMessage = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Support chat';
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
};

const ensureChatTicket = async (user: { id: string; fullName: string }, text: string) => {
  const existing = await SupportIssue.findOne({
    userId: user.id,
    status: { $in: ['open', 'in_progress'] }
  }).sort({ updatedAt: -1 });

  if (existing) {
    existing.set({
      description: existing.description || text,
      status: existing.status === 'open' ? 'open' : 'in_progress'
    });
    await existing.save();
    return existing;
  }

  return SupportIssue.create({
    userId: user.id,
    title: ticketTitleFromMessage(text),
    description: text,
    urgency: 'low',
    status: 'open'
  });
};

export const initializeSocket = (server: HttpServer) => {
  io = new SocketServer(server, {
    cors: { origin: true, credentials: true }
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
      if (payload.type !== 'access') throw new Error('Invalid token type');

      const user = await User.findById(payload.sub);
      if (!user || ['disabled', 'rejected', 'deleted'].includes(user.status)) {
        return next(new Error('Authentication required'));
      }

      socket.data.user = {
        id: user._id.toString(),
        userType: user.userType,
        status: user.status,
        fullName: user.fullName
      };
      next();
    } catch {
      next(new Error('Invalid or expired access token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: string; userType: string; fullName: string };
    socket.join(supportUserRoom(user.id));
    if (user.userType === 'admin') socket.join(adminRoom);

    socket.on('chat:message', async (payload, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : undefined;

      try {
        const text = typeof payload?.message === 'string' ? payload.message.trim() : '';
        if (!text) {
          ack?.({ ok: false, error: 'Message text is required' });
          socket.emit('chat:error', { message: 'Message text is required' });
          return;
        }

        const issue = await ensureChatTicket(user, text);
        const freshUser = await User.findById(user.id);
        const message = await SupportMessage.create({
          userId: user.id,
          sender: 'user',
          text,
          status: 'sent'
        });
        issue.updatedAt = message.createdAt;
        await issue.save();

        if (freshUser) emitSupportTicket(issue, freshUser);
        emitSupportMessage(message);

        ack?.({
          ok: true,
          message: messageForUser(message)
        });
      } catch (error) {
                ack?.({ ok: false, error: 'Unable to send message. Please try again.' });
        socket.emit('chat:error', { message: 'Unable to send message. Please try again.' });
      }
    });
  });

  return io;
};

export const emitSupportMessage = (message: SupportMessageLike) => {
  if (!io) return;

  const userId = idString(message.userId);
  io.to(supportUserRoom(userId)).emit('support:message', {
    userId,
    message: messageForUser(message)
  });
  if (message.sender === 'support') {
    io.to(supportUserRoom(userId)).emit('chat:done', {
      reply: message.text
    });
  }
  io.to(adminRoom).emit('support:message', {
    userId,
    message: messageForAdmin(message)
  });
};

export const emitSupportTicket = (issue: SupportIssueLike, user: IUser) => {
  if (!io) return;
  io.to(adminRoom).emit('support:ticket', ticketForAdmin(issue, user));
};

export const emitSupportTicketDeleted = (ticketId: string) => {
  if (!io) return;
  io.to(adminRoom).emit('support:ticket:deleted', { ticketId });
};
