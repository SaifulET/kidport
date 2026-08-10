import { Types } from 'mongoose';
import { DEVELOPMENT_STAGE_SCORE, type DevelopmentStage } from '../constants/stages';
import { Invitation } from '../modules/care-circle/invitation.model';
import { CareCircleMembership } from '../modules/care-circle/care-circle-membership.model';
import { Child } from '../modules/children/child.model';
import { DaycareChildAssignment } from '../modules/daycare/daycare-child-assignment.model';
import { DaycareMember } from '../modules/daycare/daycare-member.model';
import { DevelopmentDomain } from '../modules/domains/development-domain.model';
import { DevelopmentIndicator } from '../modules/domains/development-indicator.model';
import { Observation } from '../modules/observations/observation.model';
import { NotificationService } from './NotificationService';
import { StorageService, type StoredMedia } from './StorageService';
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
    await this.validateDomainIndicator(input.domainId, input.indicatorId);
    const child = await Child.findById(input.childId);
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

    const stageScore = input.stage ? DEVELOPMENT_STAGE_SCORE[input.stage] : undefined;
    const isMilestone = this.isMilestoneStage(input.stage);
    const observation = await Observation.create({
      childId: input.childId,
      authorId: input.authorId,
      authorRelationship: 'caregiver',
      daycareId: child.daycare,
      classroomId: child.classroom,
      type: input.type,
      text: input.text,
      media,
      domainId: input.domainId,
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

    return observation;
  }
}

export class InvitationWorkflowService {
  static async acceptCareCircleInvitation(tokenHash: string, userId: string) {
    const invitation = await Invitation.findOne({ tokenHash, type: 'care_circle', status: 'pending' });
    if (!invitation || invitation.expiresAt < new Date()) throw new AppError('Invitation is invalid or expired', 400);
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
