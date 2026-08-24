import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { upload } from '../../middlewares/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { paginationFromQuery } from '../../utils/pagination';
import { AppError } from '../../utils/AppError';
import { StorageService } from '../../services/StorageService';
import { NotificationService } from '../../services/NotificationService';
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

const welcomeText = (name: string) => {
  const firstName = name.trim().split(/\s+/)[0] || 'there';
  return `Hi ${firstName}! I'm Maya from KidPort support. How can I help you today?`;
};

supportRouter.get('/support/messages', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const userId = req.user!._id;
  const existingCount = await SupportMessage.countDocuments({ userId });

  if (existingCount === 0) {
    await SupportMessage.create({
      userId,
      sender: 'support',
      text: welcomeText(req.user!.fullName),
      status: 'sent'
    });
  }

  const [total, messages] = await Promise.all([
    SupportMessage.countDocuments({ userId }),
    SupportMessage.find({ userId }).sort({ createdAt: 1 }).skip(skip).limit(limit)
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
  const sentMessage = await SupportMessage.create({
    userId,
    sender: 'user',
    text,
    status: 'sent'
  });
  const autoReply = await SupportMessage.create({
    userId,
    sender: 'support',
    text: 'Thanks for reaching out! Let me help you with that. Could you provide more details?',
    status: 'sent'
  });

  ok(res, 'Support message sent', {
    thread: supportThread(userId.toString()),
    sentMessage: messagePayload(sentMessage),
    autoReply: messagePayload(autoReply)
  }, 201);
}));

supportRouter.post('/support/issues', upload.array('attachments', 5), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const attachments = await Promise.all(files.map((file) => StorageService.uploadBuffer(`support/${req.user!._id}`, file)));
  const issue = await SupportIssue.create({ ...req.body, userId: req.user!._id, attachments });
  void NotificationService.createForAdmins('support_issue_created', 'New support ticket', `${req.user!.fullName} opened a support ticket: ${issue.title}.`, {
    ticketId: issue._id.toString(),
    userId: req.user!._id.toString(),
    link: '/support'
  }).catch((error) => console.error('Failed to create admin support notification', error));
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
