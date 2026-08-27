import { Types } from 'mongoose';
import { Comment } from '../modules/comments/comment.model';
import { CommentReaction } from '../modules/comments/comment-reaction.model';
import { Reaction } from '../modules/reactions/reaction.model';

type CountMaps = {
  reactions: Map<string, number>;
  comments: Map<string, number>;
};

const roleLabels: Record<string, string> = {
  mother: 'Mom',
  father: 'Dad',
  grandmother: 'Grandma',
  grandfather: 'Grandpa',
  aunt: 'Aunt',
  uncle: 'Uncle',
  nanny: 'Nanny',
  teacher: 'Teacher',
  admin: 'Admin',
  staff: 'Staff',
  owner: 'Owner'
};

const titleCase = (value?: string | null) =>
  value
    ? value
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : null;

const mediaUrl = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'url' in value) return (value as { url?: string }).url ?? null;
  return null;
};

const initials = (name?: string | null) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || null;

const timeAgo = (value?: Date | string | null) => {
  if (!value) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
};

const objectId = (value: unknown) => new Types.ObjectId(String(value));

const observationProcessingStatus = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const metadata = value as { observationProcessing?: { status?: unknown; queuedAt?: unknown; startedAt?: unknown; completedAt?: unknown; failedAt?: unknown } };
  const processing = metadata.observationProcessing;
  if (!processing || typeof processing.status !== 'string') return null;

  return {
    status: processing.status,
    queuedAt: processing.queuedAt ?? null,
    startedAt: processing.startedAt ?? null,
    completedAt: processing.completedAt ?? null,
    failedAt: processing.failedAt ?? null
  };
};

const domainPayload = (value: unknown) => {
  if (!value) return { domain: null, domainId: null, domainName: null };
  if (typeof value === 'string' || value instanceof Types.ObjectId) {
    const id = value.toString();
    return { domain: { id, name: null, slug: null }, domainId: id, domainName: null };
  }
  if (typeof value !== 'object') return { domain: null, domainId: null, domainName: null };

  const data = value as { _id?: unknown; id?: unknown; name?: string; slug?: string };
  const id = data._id?.toString?.() ?? data.id?.toString?.() ?? null;
  const name = data.name ?? null;
  return {
    domain: id || name ? { id, name, slug: data.slug ?? null } : null,
    domainId: id,
    domainName: name
  };
};

export class SocialResponseService {
  static author(user: unknown) {
    if (!user || typeof user !== 'object' || !('fullName' in user)) return null;
    const data = user as {
      fullName?: string;
      profilePhoto?: unknown;
      caregiverRole?: string;
      daycareRole?: string;
      userType?: string;
    };
    const role = data.caregiverRole ?? data.daycareRole ?? data.userType;
    return {
      fullName: data.fullName ?? null,
      role: role ? roleLabels[role] ?? titleCase(role) : null,
      profilePhoto: mediaUrl(data.profilePhoto),
      initials: initials(data.fullName)
    };
  }

  static async observationCountMaps(observationIds: unknown[]): Promise<CountMaps> {
    const ids = observationIds.map(objectId);
    const [reactions, comments] = await Promise.all([
      Reaction.aggregate([{ $match: { observationId: { $in: ids } } }, { $group: { _id: '$observationId', count: { $sum: 1 } } }]),
      Comment.aggregate([{ $match: { observationId: { $in: ids }, status: 'active' } }, { $group: { _id: '$observationId', count: { $sum: 1 } } }])
    ]);
    return {
      reactions: new Map(reactions.map((item) => [String(item._id), item.count])),
      comments: new Map(comments.map((item) => [String(item._id), item.count]))
    };
  }

  static observation(observation: unknown, counts?: CountMaps) {
    const data = typeof observation === 'object' && observation && 'toObject' in observation
      ? (observation as { toObject: () => Record<string, unknown> }).toObject()
      : (observation as Record<string, unknown>);
    const id = String(data._id);
    const domain = data.domainId as { name?: string } | undefined;
    const domainData = domainPayload(data.domainId);
    const indicator = data.indicatorId as { title?: string } | undefined;
    const isMilestone = Boolean(data.isMilestone);
    return {
      id,
      author: this.author(data.authorId),
      timeAgo: timeAgo(data.createdAt as Date | string | undefined),
      observation: data.observation ?? data.text ?? null,
      title: data.title ?? null,
      description: data.description ?? null,
      progress: data.progress ?? null,
      icon: data.icon ?? null,
      domain: domainData.domain,
      domainId: domainData.domainId,
      domainName: domainData.domainName,
      status: data.status ?? null,
      aiProcessing: observationProcessingStatus(data.aiMetadata),
      milestone: isMilestone
        ? {
            detected: true,
            title: 'AI Milestone Detected',
            domain: domain?.name ?? null,
            indicator: indicator?.title ?? data.title ?? null
          }
        : null,
      reactions: counts?.reactions.get(id) ?? 0,
      comments: counts?.comments.get(id) ?? 0,
      media: data.media ?? []
    };
  }

  static observations(observations: unknown[], counts: CountMaps) {
    return observations.map((observation) => this.observation(observation, counts));
  }

  static async commentReactionCountMap(commentIds: unknown[]) {
    const ids = commentIds.map(objectId);
    const reactions = await CommentReaction.aggregate([{ $match: { commentId: { $in: ids } } }, { $group: { _id: '$commentId', count: { $sum: 1 } } }]);
    return new Map(reactions.map((item) => [String(item._id), item.count]));
  }

  static comment(comment: unknown, reactionCounts?: Map<string, number>) {
    const data = typeof comment === 'object' && comment && 'toObject' in comment
      ? (comment as { toObject: () => Record<string, unknown> }).toObject()
      : (comment as Record<string, unknown>);
    const id = String(data._id);
    return {
      id,
      author: this.author(data.authorId),
      text: data.text ?? null,
      timeAgo: timeAgo(data.createdAt as Date | string | undefined),
      reactions: reactionCounts?.get(id) ?? 0
    };
  }

  static comments(comments: unknown[], reactionCounts?: Map<string, number>) {
    return comments.map((comment) => this.comment(comment, reactionCounts));
  }
}
