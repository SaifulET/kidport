import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { Server as SocketServer } from 'socket.io';
import { env } from './config/env';
import { User, type IUser } from './modules/users/user.model';

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
    const user = socket.data.user as { id: string; userType: string };
    socket.join(supportUserRoom(user.id));
    if (user.userType === 'admin') socket.join(adminRoom);
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
