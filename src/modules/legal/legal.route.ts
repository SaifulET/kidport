import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { LegalAcceptance } from './legal-acceptance.model';
import { LegalDocument } from './legal-document.model';

export const legalRouter = Router();

const fallback = {
  terms: { key: 'terms', version: '2026-08-10', title: 'Terms of Use', content: 'Kidport terms are managed by backend configuration.' },
  'privacy-policy': { key: 'privacy-policy', version: '2026-08-10', title: 'Privacy Policy', content: 'Kidport privacy terms are managed by backend configuration.' },
  'ai-disclaimer': {
    key: 'ai-disclaimer',
    version: '2026-08-10',
    title: 'AI Disclaimer',
    content: 'AI-generated information is developmental guidance, not a medical diagnosis, and should not replace professional pediatric evaluation.'
  }
};

const getDocument = (key: keyof typeof fallback) =>
  asyncHandler(async (_req, res) => {
    const doc = await LegalDocument.findOne({ key, status: 'active' }).sort({ effectiveAt: -1 });
    ok(res, 'Legal document', doc ?? fallback[key]);
  });

const legalDocumentParamsSchema = z.object({
  params: z.object({
    key: z.enum(['terms', 'privacy-policy', 'ai-disclaimer'])
  })
});

const createLegalDocumentSchema = legalDocumentParamsSchema.extend({
  body: z.object({
    version: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    content: z.string().min(1),
    effectiveAt: z.coerce.date().optional()
  })
});

legalRouter.get('/terms', getDocument('terms'));
legalRouter.get('/privacy-policy', getDocument('privacy-policy'));
legalRouter.get('/ai-disclaimer', getDocument('ai-disclaimer'));

legalRouter.post(
  '/accept',
  requireAuth,
  validate(
    z.object({
      body: z.object({
        termsVersion: z.string(),
        privacyVersion: z.string().optional(),
        aiDisclaimerVersion: z.string().optional()
      })
    })
  ),
  asyncHandler(async (req, res) => {
    const acceptance = await LegalAcceptance.create({
      userId: req.user!._id,
      termsVersion: req.body.termsVersion,
      privacyVersion: req.body.privacyVersion,
      aiDisclaimerVersion: req.body.aiDisclaimerVersion,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    ok(res, 'Legal acceptance recorded', acceptance, 201);
  })
);

legalRouter.post(
  '/:key',
  requireAuth,
  validate(createLegalDocumentSchema),
  asyncHandler(async (req, res) => {
    const key = req.params.key as keyof typeof fallback;
    const effectiveAt = req.body.effectiveAt ?? new Date();
    const version = req.body.version ?? effectiveAt.toISOString().slice(0, 10);

    await LegalDocument.updateMany({ key, status: 'active' }, { $set: { status: 'archived' } });
    const doc = await LegalDocument.create({
      key,
      version,
      title: req.body.title ?? fallback[key].title,
      content: req.body.content,
      effectiveAt,
      status: 'active'
    });

    ok(res, 'Legal document created', doc, 201);
  })
);
