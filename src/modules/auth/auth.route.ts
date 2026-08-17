import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../users/user.model';
import { UserSettings } from '../settings/user-settings.model';
import { TokenService } from '../../services/TokenService';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { randomOtp, hashToken } from '../../utils/crypto';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { registerSchema, loginSchema, refreshSchema } from './auth.validation';
import { EmailService } from '../../services/EmailService';

export const authRouter = Router();

const identityToAccount = (identity: string) =>
  identity === 'daycare'
    ? { userType: 'daycare' as const, daycareRole: 'daycare_admin' as const }
    : { userType: 'caregiver' as const, caregiverRole: identity as 'mother' | 'father' | 'parent' | 'nanny' };

const passwordResetOtpSchema = z.object({
  body: z.object({
    email: z.string().email(),
    otp: z.string().regex(/^\d{4}$/, 'OTP must be 4 digits')
  })
});

authRouter.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const existing = await User.findOne({ email: req.body.email });
    if (existing) throw new AppError('Email is already registered', 409);
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const user = await User.create({ fullName: req.body.fullName, email: req.body.email, passwordHash, ...identityToAccount(req.body.identity) });
    await UserSettings.create({ userId: user._id });
    const accessToken = TokenService.signAccessToken(user._id);
    const refreshToken = await TokenService.issueRefreshToken(user._id, { ip: req.ip, userAgent: req.get('user-agent') });
    ok(res, 'Registration successful', { user, accessToken, refreshToken }, 201);
  })
);

authRouter.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) throw new AppError('Invalid email or password', 401);
    const accessToken = TokenService.signAccessToken(user._id);
    const refreshToken = await TokenService.issueRefreshToken(user._id, { ip: req.ip, userAgent: req.get('user-agent') });
    ok(res, 'Login successful', { user, accessToken, refreshToken });
  })
);

authRouter.post(
  '/refresh-token',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const rotated = await TokenService.rotateRefreshToken(req.body.refreshToken, { ip: req.ip, userAgent: req.get('user-agent') });
    if (!rotated) throw new AppError('Invalid or expired refresh token', 401);
    ok(res, 'Token refreshed', { accessToken: TokenService.signAccessToken(rotated.userId), refreshToken: rotated.refreshToken });
  })
);

authRouter.post(
  '/logout',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    await TokenService.revoke(req.body.refreshToken);
    ok(res, 'Logged out');
  })
);

authRouter.post(
  '/forgot-password',
  validate(z.object({ body: z.object({ email: z.string().email() }) })),
  asyncHandler(async (req, res) => {
    const email = req.body.email.toLowerCase().trim();
    const user = await User.findOne({ email });
    if (user) {
      const otp = randomOtp();
      user.passwordResetTokenHash = hashToken(otp);
      user.passwordResetExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      await EmailService.sendMail(
        user.email,
        'Your Kidport password reset OTP',
        `<p>Your Kidport password reset OTP is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`
      );
    }
    ok(res, 'If the email exists, a password reset OTP has been sent');
  })
);

authRouter.post(
  '/verify-reset-otp',
  validate(passwordResetOtpSchema),
  asyncHandler(async (req, res) => {
    const email = req.body.email.toLowerCase().trim();
    const user = await User.findOne({
      email,
      passwordResetTokenHash: hashToken(req.body.otp),
      passwordResetExpiresAt: { $gt: new Date() }
    });
    if (!user) throw new AppError('Invalid or expired OTP', 400);
    ok(res, 'OTP verified');
  })
);

authRouter.post(
  '/reset-password',
  validate(passwordResetOtpSchema.extend({ body: passwordResetOtpSchema.shape.body.extend({ password: z.string().min(8) }) })),
  asyncHandler(async (req, res) => {
    const email = req.body.email.toLowerCase().trim();
    const user = await User.findOne({
      email,
      passwordResetTokenHash: hashToken(req.body.otp),
      passwordResetExpiresAt: { $gt: new Date() }
    });
    if (!user) throw new AppError('Invalid or expired OTP', 400);
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();
    ok(res, 'Password reset successful');
  })
);

authRouter.post(
  '/change-password',
  requireAuth,
  validate(z.object({ body: z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }) })),
  asyncHandler(async (req, res) => {
    if (!req.user || !(await bcrypt.compare(req.body.currentPassword, req.user.passwordHash))) throw new AppError('Current password is incorrect', 400);
    req.user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await req.user.save();
    ok(res, 'Password changed');
  })
);

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => ok(res, 'Current user', req.user)));
