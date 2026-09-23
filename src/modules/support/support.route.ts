import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { upload } from '../../middlewares/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { paginationFromQuery } from '../../utils/pagination';
import { AppError } from '../../utils/AppError';
import { StorageService } from '../../services/StorageService';
import { NotificationService } from '../../services/NotificationService';
import { emitSupportMessage, emitSupportTicket } from '../../socket';
import { SupportIssue } from './support-issue.model';
import { FeatureRequest } from './feature-request.model';
import { SupportMessage } from './support-message.model';

export const supportRouter = Router();
supportRouter.use(requireAuth);

const supportThread = (userId: string) => ({
  id: `support-${userId}`,
  title: 'Support Team',
  subtitle: 'Usually replies within minutes'
});

const messagePayload = (message: InstanceType<typeof SupportMessage>) => ({
  id: message._id.toString(),
  sender: message.sender,
  text: message.text,
  sentAt: message.createdAt,
  status: message.status
});

const legacyAutoReplyText = 'Thanks for reaching out! Let me help you with that. Could you provide more details?';
const nonLegacySupportMessageFilter = { text: { $ne: legacyAutoReplyText } };

const removeLegacyAutoReplies = () =>
  SupportMessage.deleteMany({ sender: 'support', text: legacyAutoReplyText }).catch(() => {});

const ticketTitleFromMessage = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Support chat';
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
};

const ensureSupportTicket = async (userId: unknown, text: string) => {
  const existing = await SupportIssue.findOne({
    userId,
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
    userId,
    title: ticketTitleFromMessage(text),
    description: text,
    urgency: 'low',
    status: 'open'
  });
};

supportRouter.get('/support/messages', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const userId = req.user!._id;
  void removeLegacyAutoReplies();

  const [total, messages] = await Promise.all([
    SupportMessage.countDocuments({ userId, ...nonLegacySupportMessageFilter }),
    SupportMessage.find({ userId, ...nonLegacySupportMessageFilter }).sort({ createdAt: 1 }).skip(skip).limit(limit)
  ]);
  res.json({
    success: true,
    message: 'Support messages',
    data: {
    thread: supportThread(userId.toString()),
    messages: messages.map(messagePayload)
    },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}));

supportRouter.post('/support/messages', asyncHandler(async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) throw new AppError('Message text is required', 400);

  const userId = req.user!._id;
  void removeLegacyAutoReplies();
  const issue = await ensureSupportTicket(userId, text);
  const sentMessage = await SupportMessage.create({
    userId,
    sender: 'user',
    text,
    status: 'sent'
  });
  issue.updatedAt = sentMessage.createdAt;
  await issue.save();
  emitSupportTicket(issue, req.user!);
  emitSupportMessage(sentMessage);

  ok(res, 'Support message sent', {
    thread: supportThread(userId.toString()),
    sentMessage: messagePayload(sentMessage)
  }, 201);
}));

supportRouter.post('/support/issues', upload.array('attachments', 5), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const attachments = await Promise.all(files.map((file) => StorageService.uploadBuffer(`support/${req.user!._id}`, file)));
  const issue = await SupportIssue.create({ ...req.body, userId: req.user!._id, attachments });
  emitSupportTicket(issue, req.user!);
  void NotificationService.createForAdmins('support_issue_created', 'New support ticket', `${req.user!.fullName} opened a support ticket: ${issue.title}.`, {
    ticketId: issue._id.toString(),
    userId: req.user!._id.toString(),
    link: '/support'
  }).catch(() => {});
  ok(res, 'Support issue submitted', issue, 201);
}));

supportRouter.post('/support/feature-requests', upload.array('images', 5), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const images = await Promise.all(files.map((file) => StorageService.uploadBuffer(`feature-requests/${req.user!._id}`, file)));
  const feature = await FeatureRequest.create({ ...req.body, userId: req.user!._id, images });
  ok(res, 'Feature request submitted', feature, 201);
}));

supportRouter.post('/feature-requests', upload.array('images', 5), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const images = await Promise.all(files.map((file) => StorageService.uploadBuffer(`feature-requests/${req.user!._id}`, file)));
  const feature = await FeatureRequest.create({ ...req.body, userId: req.user!._id, images });
  ok(res, 'Feature request submitted', feature, 201);
}));

