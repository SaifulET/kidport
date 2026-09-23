import type { IUser } from '../modules/users/user.model';
import { RefreshToken } from '../modules/auth/refresh-token.model';

export class AccountDeletionService {
  static async deleteUserAccount(user: IUser) {
    const deletedAt = new Date();

    user.status = 'deleted';
    user.deletedAt = deletedAt;
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    user.passwordResetSessionHash = undefined;
    user.passwordResetSessionExpiresAt = undefined;
    await user.save();

    await RefreshToken.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: deletedAt } }
    );

    return {
      deletedAt,
      userId: user._id.toString()
    };
  }
}
