import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, paginated } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import { AuthorizationService } from '../../services/AuthorizationService';
import { NotificationService } from '../../services/NotificationService';
import { SocialResponseService } from '../../services/SocialResponseService';
import { Observation } from '../observations/observation.model';
import { Comment } from './comment.model';
import { CommentReaction } from './comment-reaction.model';

export const commentsRouter = Router();
commentsRouter.use(requireAuth);

commentsRouter.post('/observations/:observationId/comments', validate(z.object({ body: z.object({ text: z.string().min(1) }) })), asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);
  const comment = await Comment.create({ observationId: observation._id, childId: observation.childId, authorId: req.user!._id, text: req.body.text });
  if (observation.authorId.toString() !== req.user!._id.toString()) {
    await NotificationService.create(observation.authorId.toString(), 'new_comment', 'New comment', `${req.user!.fullName} commented on an observation.`, {
      observationId: observation._id.toString(),
      childId: observation.childId.toString()
    });
  }
  const populated = await Comment.findById(comment._id).populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType');
  ok(res, 'Comment created', SocialResponseService.comment(populated ?? comment), 201);
}));

commentsRouter.post('/comments/:commentId/reactions', asyncHandler(async (req, res) => {
  const comment = await Comment.findOne({ _id: req.params.commentId, status: 'active' });
  if (!comment) throw new AppError('Comment not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), comment.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);

  await CommentReaction.findOneAndUpdate(
    { commentId: comment._id, userId: req.user!._id, type: req.body.type ?? 'love' },
    { $setOnInsert: { childId: comment.childId } },
    { upsert: true, new: true }
  );

  const populated = await Comment.findById(comment._id).populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType');
  const reactionCounts = await SocialResponseService.commentReactionCountMap([comment._id]);
  ok(res, 'Comment reaction saved', SocialResponseService.comment(populated ?? comment, reactionCounts), 201);
}));

commentsRouter.delete('/comments/:commentId/reactions', asyncHandler(async (req, res) => {
  const comment = await Comment.findOne({ _id: req.params.commentId, status: 'active' });
  if (!comment) throw new AppError('Comment not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), comment.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);

  await CommentReaction.deleteOne({ commentId: comment._id, userId: req.user!._id, type: req.body.type ?? 'love' });

  const populated = await Comment.findById(comment._id).populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType');
  const reactionCounts = await SocialResponseService.commentReactionCountMap([comment._id]);
  ok(res, 'Comment reaction removed', SocialResponseService.comment(populated ?? comment, reactionCounts));
}));

commentsRouter.get('/observations/:observationId/comments', asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.observationId);
  if (!observation) throw new AppError('Observation not found', 404);
  const access = await AuthorizationService.getChildAccess(req.user!._id.toString(), observation.childId.toString());
  if (!access) throw new AppError('You do not have access to this child', 403);
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const filter = { observationId: observation._id, status: 'active' };
  const total = await Comment.countDocuments(filter);
  const comments = await Comment.find(filter)
    .populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  const reactionCounts = await SocialResponseService.commentReactionCountMap(comments.map((comment) => comment._id));
  paginated(res, 'Comments', SocialResponseService.comments(comments, reactionCounts), page, limit, total);
}));

commentsRouter.patch('/comments/:commentId', asyncHandler(async (req, res) => {
  const comment = await Comment.findOneAndUpdate({ _id: req.params.commentId, authorId: req.user!._id }, { $set: { text: req.body.text } }, { new: true }).populate('authorId', 'fullName profilePhoto caregiverRole daycareRole userType');
  const reactionCounts = comment ? await SocialResponseService.commentReactionCountMap([comment._id]) : undefined;
  ok(res, 'Comment updated', comment ? SocialResponseService.comment(comment, reactionCounts) : null);
}));

commentsRouter.delete('/comments/:commentId', asyncHandler(async (req, res) => {
  await Comment.updateOne({ _id: req.params.commentId, authorId: req.user!._id }, { $set: { status: 'deleted' } });
  ok(res, 'Comment deleted');
}));
