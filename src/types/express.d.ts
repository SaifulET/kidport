import type { IUser } from '../modules/users/user.model';

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      childAccess?: {
        childId: string;
        daycareId?: string;
        isOwner: boolean;
      };
    }
  }
}
