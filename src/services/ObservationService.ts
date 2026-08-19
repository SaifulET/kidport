import { Types } from 'mongoose';
import { DEVELOPMENT_STAGE_SCORE, type DevelopmentStage } from '../constants/stages';
import { Invitation } from '../modules/care-circle/invitation.model';
import { CareCircleMembership } from '../modules/care-circle/care-circle-membership.model';
import { Child } from '../modules/children/child.model';
import { DaycareChildAssignment } from '../modules/daycare/daycare-child-assignment.model';
import { DaycareMember } from '../modules/daycare/daycare-member.model';
import { User } from '../modules/users/user.model';
import { DevelopmentDomain } from '../modules/domains/development-domain.model';
import { DevelopmentIndicator } from '../modules/domains/development-indicator.model';
import { Observation } from '../modules/observations/observation.model';
import { NotificationService } from './NotificationService';
import { StorageService, type StoredMedia } from './StorageService';
import { AIAnalysisService } from './AIAnalysisService';
import { DevelopmentScoringService } from './DevelopmentScoringService';
import { AppError } from '../utils/AppError';

export type CreateObservationInput = {
  childId: string;
  authorId: string;
  type: 'text' | 'voice' | 'photo' | 'video';
  text?: string;
  domainId?: string;
  indicatorId?: string;
  stage?: DevelopmentStage;
  mood?: string;
  occurredAt?: Date;
  files?: Express.Multer.File[];
  status?: 'active' | 'draft';
};

export type UpdateDraftObservationInput = {
  observationId: string;
  userId: string;
  type?: 'text' | 'voice' | 'photo' | 'video';
  text?: string;
  domainId?: string;
  indicatorId?: string;
  stage?: DevelopmentStage;
  mood?: string;
  occurredAt?: Date;
  status?: 'active' | 'draft';
};

type MediaProcessingJob = {
  observationId: string;
  childId: string;
  providedText?: string;
  media: StoredMedia[];
  domainName?: string;
  indicatorTitle?: string;
  stage?: DevelopmentStage;
  stageScore?: number;
};

export class ObservationService {
  static isMilestoneStage(stage?: DevelopmentStage) {
    return stage === 'confident';
  }

  static async resolveDomainId(domain?: string) {
    if (!domain) return undefined;
    const query = Types.ObjectId.isValid(domain)
      ? { _id: domain, status: 'active' }
      : {
          status: 'active',
          $or: [
            { name: new RegExp(`^${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            { slug: domain.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }
          ]
        };
    const doc = await DevelopmentDomain.findOne(query);
    if (!doc) throw new AppError('Development domain not found', 404);
    return doc._id.toString();
  }

  static async validateDomainIndicator(domainId?: string, indicatorId?: string) {
    if (!domainId && !indicatorId) return;
    const domain = domainId ? await DevelopmentDomain.findOne({ _id: domainId, status: 'active' }) : null;
    if (domainId && !domain) throw new AppError('Development domain not found', 404);
    if (indicatorId) {
      const indicator = await DevelopmentIndicator.findOne({ _id: indicatorId, status: 'active' });
      if (!indicator) throw new AppError('Development indicator not found', 404);
      if (domainId && indicator.domainId.toString() !== domainId) {
        throw new AppError('Indicator does not belong to the selected domain', 400);
      }
    }
  }

  private static mediaFallbackText(media: StoredMedia[]) {
    return `Media observation uploaded: ${media.map((file) => file.originalName ?? file.key.split('/').pop() ?? 'media').join(', ')}`;
  }

  private static queueMediaProcessing(job: MediaProcessingJob) {
    setImmediate(() => {
      void this.processMediaObservation(job).catch((error) => {
        console.error('Failed to process media observation', error);
      });
    });
  }

  private static async processMediaObservation(job: MediaProcessingJob) {
    try {
      await Observation.updateOne(
        { _id: job.observationId },
        {
          $set: {
            'aiMetadata.observationProcessing.status': 'processing',
            'aiMetadata.observationProcessing.startedAt': new Date()
          }
        }
      );

      const mediaText = await AIAnalysisService.generateObservationTextFromStoredMedia(job.media);
      const text =
        (await AIAnalysisService.generateObservationText({
          providedText: job.providedText,
          mediaText: mediaText ?? this.mediaFallbackText(job.media),
          domain: job.domainName,
          indicatorTitle: job.indicatorTitle,
          stage: job.stage,
          stageScore: job.stageScore
        })) ?? this.mediaFallbackText(job.media);
      const display = await AIAnalysisService.generateObservationDisplay({
        text,
        domain: job.domainName,
        indicatorTitle: job.indicatorTitle,
        stage: job.stage,
        stageScore: job.stageScore
      });

      await Observation.updateOne(
        { _id: job.observationId },
        {
          $set: {
            text,
            title: display.title,
            description: display.description,
            progress: display.progress,
            icon: display.icon,
            'aiMetadata.observationProcessing.status': 'completed',
            'aiMetadata.observationProcessing.completedAt': new Date(),
            'aiMetadata.observationProcessing.mediaTextGenerated': Boolean(mediaText),
            'aiMetadata.observationProcessing.mediaCount': job.media.length
          }
        }
      );

      void DevelopmentScoringService.refreshChildDevelopmentSnapshot(job.childId).catch((error) => {
        console.error('Failed to refresh child development snapshot after media processing', error);
      });
    } catch (error) {
      await Observation.updateOne(
        { _id: job.observationId },
        {
          $set: {
            'aiMetadata.observationProcessing.status': 'failed',
            'aiMetadata.observationProcessing.failedAt': new Date(),
            'aiMetadata.observationProcessing.error': error instanceof Error ? error.message : 'Unknown media processing error'
          }
        }
      );
      throw error;
    }
  }

  static async create(input: CreateObservationInput) {
    const status = input.status ?? 'active';
    const isDraft = status === 'draft';
    const domainId = await this.resolveDomainId(input.domainId);
    await this.validateDomainIndicator(domainId, input.indicatorId);
    const [child, domain, indicator] = await Promise.all([
      Child.findById(input.childId),
      domainId ? DevelopmentDomain.findById(domainId).select('name') : null,
      input.indicatorId ? DevelopmentIndicator.findById(input.indicatorId).select('title description') : null
    ]);
    if (!child) throw new AppError('Child not found', 404);

    let media: StoredMedia[] = [];
    if (input.files?.length) {
      const folder =
        input.type === 'voice'
          ? 'audio'
          : input.type === 'video'
            ? 'videos'
            : input.type === 'photo'
              ? 'images'
              : 'files';
      media = await Promise.all(input.files.map((file) => StorageService.uploadBuffer(`children/${input.childId}/observations/${folder}`, file)));
    }

    const providedText = input.text?.trim();
    const stageScore = input.stage ? DEVELOPMENT_STAGE_SCORE[input.stage] : undefined;
    const mediaText = !isDraft && input.files?.length ? await AIAnalysisService.generateObservationTextFromMedia(input.files) : null;
    const generatedText =
      isDraft
        ? providedText || (media.length ? this.mediaFallbackText(media) : undefined)
        : await AIAnalysisService.generateObservationText({
            providedText,
            mediaText: mediaText ?? (media.length ? this.mediaFallbackText(media) : undefined),
            domain: domain?.name,
            indicatorTitle: indicator?.title,
            stage: input.stage,
            stageScore,
            type: input.type
          });
    const text = generatedText ?? undefined;

    const displayInput = {
      text,
      domain: domain?.name,
      indicatorTitle: indicator?.title,
      stage: input.stage,
      stageScore
    };
    const display = isDraft
      ? null
      : await AIAnalysisService.generateObservationDisplay(displayInput);

    const isMilestone = !isDraft && this.isMilestoneStage(input.stage);
    const observation = await Observation.create({
      childId: input.childId,
      authorId: input.authorId,
      authorRelationship: 'caregiver',
      daycareId: child.daycare,
      classroomId: child.classroom,
      type: input.type,
      text,
      title: display?.title,
      description: display?.description,
      progress: display?.progress,
      media,
      icon: display?.icon,
      domainId,
      indicatorId: input.indicatorId,
      stage: input.stage,
      stageScore,
      mood: input.mood,
      occurredAt: input.occurredAt ?? new Date(),
      isMilestone,
      status,
      aiMetadata: !isDraft && media.length
        ? {
            observationProcessing: {
              status: 'completed',
              completedAt: new Date(),
              mediaTextGenerated: Boolean(mediaText),
              mediaCount: media.length
            }
          }
        : undefined
    });

    if (isMilestone) {
      const membershipUserIds = await CareCircleMembership.find({ childId: input.childId, status: 'active' }).distinct('userId');
      const recipients = [child.createdBy.toString(), ...membershipUserIds.map(String)];
      await NotificationService.createMany([...new Set(recipients)], 'milestone_achieved', 'New milestone achieved', `${child.fullName} reached a confident milestone.`, {
        childId: input.childId,
        observationId: observation._id.toString()
      });
    }

    if (!isDraft) {
      void DevelopmentScoringService.refreshChildDevelopmentSnapshot(input.childId).catch((error) => {
        console.error('Failed to refresh child development snapshot', error);
      });
    }

    return observation;
  }

  static async updateDraft(input: UpdateDraftObservationInput) {
    const observation = await Observation.findById(input.observationId);
    if (!observation) throw new AppError('Observation not found', 404);
    if (observation.authorId.toString() !== input.userId) throw new AppError('Only the draft author can edit this observation', 403);
    if (observation.status !== 'draft') throw new AppError('Only draft observations can be edited', 400);

    const status = input.status ?? 'draft';
    const domainId = input.domainId !== undefined ? await this.resolveDomainId(input.domainId) : observation.domainId?.toString();
    const indicatorId = input.indicatorId !== undefined ? input.indicatorId : observation.indicatorId?.toString();
    await this.validateDomainIndicator(domainId, indicatorId);

    const [child, domain, indicator] = await Promise.all([
      Child.findById(observation.childId),
      domainId ? DevelopmentDomain.findById(domainId).select('name') : null,
      indicatorId ? DevelopmentIndicator.findById(indicatorId).select('title description') : null
    ]);
    if (!child) throw new AppError('Child not found', 404);

    const text = input.text !== undefined ? input.text?.trim() : observation.text ?? undefined;
    const stage = input.stage !== undefined ? input.stage : observation.stage ?? undefined;
    const stageScore = stage ? DEVELOPMENT_STAGE_SCORE[stage] : undefined;
    const media = observation.media ?? [];

    if (status === 'active') {
      if (!text && media.length === 0) throw new AppError('Observation text or media is required', 400);
      if (!stage) throw new AppError('Keyword is required', 400);
      if (!domainId) throw new AppError('Domain is required', 400);
    }

    const mediaText = status === 'active' && media.length ? await AIAnalysisService.generateObservationTextFromStoredMedia(media as StoredMedia[]) : null;
    const generatedObservationText =
      status === 'active'
        ? await AIAnalysisService.generateObservationText({
            providedText: text,
            mediaText: mediaText ?? (media.length ? this.mediaFallbackText(media as StoredMedia[]) : undefined),
            domain: domain?.name,
            indicatorTitle: indicator?.title,
            stage,
            stageScore,
            type: input.type ?? observation.type
          })
        : text;
    const observationText = generatedObservationText ?? undefined;

    const displayInput = {
      text: observationText,
      domain: domain?.name,
      indicatorTitle: indicator?.title,
      stage,
      stageScore
    };
    const display = status === 'active'
      ? await AIAnalysisService.generateObservationDisplay(displayInput)
      : undefined;
    const isMilestone = status === 'active' && this.isMilestoneStage(stage);

    observation.set({
      ...(input.type ? { type: input.type } : {}),
      ...(input.text !== undefined || status === 'active' ? { text: observationText } : {}),
      ...(input.domainId !== undefined ? { domainId } : {}),
      ...(input.indicatorId !== undefined ? { indicatorId } : {}),
      ...(input.stage !== undefined ? { stage, stageScore } : {}),
      ...(input.mood !== undefined ? { mood: input.mood } : {}),
      ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
      ...(display ? { title: display.title, description: display.description, progress: display.progress, icon: display.icon } : {}),
      status,
      isMilestone
    });
    await observation.save();

    if (status === 'active') {
      if (isMilestone) {
        const membershipUserIds = await CareCircleMembership.find({ childId: observation.childId, status: 'active' }).distinct('userId');
        const recipients = [child.createdBy.toString(), ...membershipUserIds.map(String)];
        await NotificationService.createMany([...new Set(recipients)], 'milestone_achieved', 'New milestone achieved', `${child.fullName} reached a confident milestone.`, {
          childId: observation.childId.toString(),
          observationId: observation._id.toString()
        });
      }

      void DevelopmentScoringService.refreshChildDevelopmentSnapshot(observation.childId.toString()).catch((error) => {
        console.error('Failed to refresh child development snapshot', error);
      });
    }

    return observation;
  }
}

export class InvitationWorkflowService {
  static async acceptCareCircleInvitation(tokenHash: string, userId: string) {
    const invitation = await Invitation.findOne({ tokenHash, type: 'care_circle', status: 'pending' });
    if (!invitation || invitation.expiresAt < new Date()) throw new AppError('Invitation is invalid or expired', 400);
    const user = await User.findOne({ _id: userId, status: 'active' });
    if (!user) throw new AppError('Authentication required', 401);
    if (user.email !== invitation.email) throw new AppError('This invitation belongs to another email', 403);
    await CareCircleMembership.updateOne(
      { childId: invitation.childId, userId },
      {
        $set: {
          childId: invitation.childId,
          userId,
          role: invitation.role ?? 'other',
          relationship: invitation.relationship ?? 'caregiver',
          invitedBy: invitation.invitedBy,
          acceptedAt: new Date(),
          status: 'active'
        }
      },
      { upsert: true }
    );
    invitation.status = 'accepted';
    invitation.acceptedBy = new Types.ObjectId(userId);
    invitation.acceptedAt = new Date();
    await invitation.save();
    return invitation;
  }

  static async acceptDaycareAssignment(tokenHash: string, userId: string) {
    const invitation = await Invitation.findOne({ tokenHash, type: 'daycare_child_assignment', status: 'pending' });
    if (!invitation || invitation.expiresAt < new Date() || !invitation.childId || !invitation.daycareId) {
      throw new AppError('Daycare invitation is invalid or expired', 400);
    }
    const member = await DaycareMember.findOne({ daycareId: invitation.daycareId, userId, status: 'active' });
    if (!member) throw new AppError('Only an authorized daycare member can accept this assignment', 403);
    const assignment = await DaycareChildAssignment.findOneAndUpdate(
      { childId: invitation.childId, daycareId: invitation.daycareId },
      { $set: { status: 'active', acceptedBy: userId, acceptedAt: new Date() } },
      { new: true, upsert: true }
    );
    await Child.updateOne({ _id: invitation.childId }, { $set: { daycare: invitation.daycareId } });
    invitation.status = 'accepted';
    invitation.acceptedBy = new Types.ObjectId(userId);
    invitation.acceptedAt = new Date();
    await invitation.save();
    return assignment;
  }
}
