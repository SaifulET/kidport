import nodemailer from 'nodemailer';
import { env } from '../config/env';

export class EmailService {
  private static transporter() {
    if (!env.SMTP_HOST) return null;
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
    });
  }

  static async sendMail(to: string, subject: string, html: string) {
    const transporter = this.transporter();
    if (!transporter) return { skipped: true, reason: 'SMTP not configured' };
    await transporter.sendMail({ from: env.SMTP_FROM, to, subject, html });
    return { skipped: false };
  }

  static careCircleInvite(to: string, token: string, message?: string) {
    const url = `${env.FRONTEND_URL}/care-circle/invitations/${token}`;
    return this.sendMail(
      to,
      'You are invited to join a child care circle',
      `<p>You have been invited to Kidport.</p><p>${message ?? ''}</p><p><a href="${url}">Accept invitation</a></p>`
    );
  }

  static daycareInvite(to: string, token: string, childName: string) {
    const url = `${env.FRONTEND_URL}/daycare-invitations/${token}`;
    return this.sendMail(to, 'A parent assigned a child to your daycare', `<p>${childName} was assigned.</p><p><a href="${url}">Review assignment</a></p>`);
  }
}
