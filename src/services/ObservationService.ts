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

  static async create(input: CreateObservationInput) {
    const domainId = await this.resolveDomainId(input.domainId);
    await this.validateDomainIndicator(domainId, input.indicatorId);
    const [child, domain, indicator] = await Promise.all([
      Child.findById(input.childId),
      domainId ? DevelopmentDomain.findById(domainId).select('name') : null,
      input.indicatorId ? DevelopmentIndicator.findById(input.indicatorId).select('title description') : null
    ]);
    if (!child) throw new AppError('Child not found', 404);

    let media: StoredMedia[] = [];
    let generatedText: string | null = null;
    if (input.files?.length) {
      const folder =
        input.type === 'voice'
          ? 'audio'
          : input.type === 'video'
            ? 'videos'
            : input.type === 'photo'
              ? 'images'
              : 'files';
      const uploadPromise = Promise.all(input.files.map((file) => StorageService.uploadBuffer(`children/${input.childId}/observations/${folder}`, file)));
      const generatedTextPromise = !input.text?.trim() ? AIAnalysisService.generateObservationTextFromMedia(input.files) : Promise.resolve(null);
      [media, generatedText] = await Promise.all([uploadPromise, generatedTextPromise]);
    }

    const text =
      input.text?.trim() ||
      generatedText ||
      (input.files?.length ? `Media observation uploaded: ${input.files.map((file) => file.originalname).join(', ')}` : undefined);

    const display = await AIAnalysisService.generateObservationDisplay({
      text,
      domain: domain?.name,
      indicatorTitle: indicator?.title,
      stage: input.stage,
      stageScore: input.stage ? DEVELOPMENT_STAGE_SCORE[input.stage] : undefined
    });

    const stageScore = input.stage ? DEVELOPMENT_STAGE_SCORE[input.stage] : undefined;
    const isMilestone = this.isMilestoneStage(input.stage);
    const observation = await Observation.create({
      childId: input.childId,
      authorId: input.authorId,
      authorRelationship: 'caregiver',
      daycareId: child.daycare,
      classroomId: child.classroom,
      type: input.type,
      text,
      title: display.title,
      description: display.description,
      progress: display.progress,
      media,
      icon: display.icon,
      domainId,
      indicatorId: input.indicatorId,
      stage: input.stage,
      stageScore,
      mood: input.mood,
      occurredAt: input.occurredAt ?? new Date(),
      isMilestone
    });

    if (isMilestone) {
      const membershipUserIds = await CareCircleMembership.find({ childId: input.childId, status: 'active' }).distinct('userId');
      const recipients = [child.createdBy.toString(), ...membershipUserIds.map(String)];
      await NotificationService.createMany([...new Set(recipients)], 'milestone_achieved', 'New milestone achieved', `${child.fullName} reached a confident milestone.`, {
        childId: input.childId,
        observationId: observation._id.toString()
      });
    }

    void DevelopmentScoringService.refreshChildDevelopmentSnapshot(input.childId).catch((error) => {
      console.error('Failed to refresh child development snapshot', error);
    });

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
