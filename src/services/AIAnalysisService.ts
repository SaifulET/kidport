import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import { env } from '../config/env';
import { StorageService, type StoredMedia } from './StorageService';

const flagsSchema = z.array(
  z.object({
    domain: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
    title: z.string(),
    description: z.string(),
    recommendation: z.string()
  })
);

const reportSchema = z.object({
  overallSummary: z.string(),
  domainSummaries: z.array(z.object({ domain: z.string(), summary: z.string() })),
  flagsToDiscuss: flagsSchema,
  positiveHighlights: z.array(z.string()),
  dataQualityExplanation: z.string()
});

const observationDisplaySchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(160),
  progress: z.number().int().min(0).max(100),
  icon: z.string().min(1).max(8)
});

const domainProgressKeywordsSchema = z.object({
  domains: z.array(
    z.object({
      domainId: z.string(),
      keyword: z.enum(['improving', 'stable', 'needs-support', 'not-enough-data'])
    })
  )
});

const observationStatusSummarySchema = z.object({
  achieved: z.number().int().min(0),
  inProgress: z.number().int().min(0),
  upcoming: z.number().int().min(0)
});

const developmentalAgeEstimateSchema = z.object({
  months: z.number().int().min(0).max(120).nullable(),
  years: z.number().int().min(0).max(10).optional(),
  remainingMonths: z.number().int().min(0).max(11).optional(),
  days: z.number().int().min(0).max(31).optional(),
  label: z.string().min(1).max(80),
  confidence: z.enum(['low', 'medium', 'high']),
  basis: z.string().min(1).max(300),
  domainMatches: z
    .array(
      z.object({
        domainId: z.string(),
        name: z.string(),
        estimatedMonths: z.number().int().min(0).max(120).nullable(),
        note: z.string().max(160).optional()
      })
    )
    .default([])
});

type DomainKeywordInput = {
  domainId: string;
  name: string;
  percentage: number | null;
  observationCount: number;
  observations: Array<{
    stage?: string | null;
    stageScore?: number | null;
    text?: string | null;
    title?: string | null;
    occurredAt?: Date | null;
  }>;
};

type ObservationStatusSummaryInput = {
  fallback: {
    achieved: number;
    inProgress: number;
    upcoming: number;
  };
  items: Array<{
    name: string;
    domain?: string;
    latestStage?: string | null;
    latestText?: string | null;
    latestTitle?: string | null;
    observed: boolean;
  }>;
};

type DevelopmentalAgeEstimateInput = {
  chronologicalAgeMonths: number;
  domains: Array<{
    domainId: string;
    name: string;
    percentage: number | null;
    stage: string;
    observationCount: number;
    keyword: string;
  }>;
  ageBands: Array<{
    id: string;
    label: string;
    minMonths: number;
    maxMonths: number;
    indicatorCount: number;
    observedCount: number;
    averageStageScore: number | null;
    confidentCount: number;
  }>;
  recentObservations: Array<{
    domain?: string;
    stage?: string | null;
    stageScore?: number | null;
    text?: string | null;
    title?: string | null;
    occurredAt?: Date | null;
  }>;
};

type MediaAnalysisFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

export class AIAnalysisService {
  private static developmentalAgeParts(totalMonths: number) {
    const years = Math.floor(totalMonths / 12);
    const remainingMonths = totalMonths % 12;
    const days: number = 0;
    const yearLabel = `${years} year${years === 1 ? '' : 's'}`;
    const monthLabel = `${remainingMonths} month${remainingMonths === 1 ? '' : 's'}`;
    const dayLabel = `${days} day${days === 1 ? '' : 's'}`;
    return { years, remainingMonths, days, label: `${yearLabel} ${monthLabel} ${dayLabel}` };
  }

  private static withDevelopmentalAgeParts<T extends { months: number | null; label: string }>(estimate: T) {
    if (estimate.months === null) return { ...estimate, label: 'Not enough data' };
    const parts = this.developmentalAgeParts(estimate.months);
    return {
      ...estimate,
      years: parts.years,
      remainingMonths: parts.remainingMonths,
      days: parts.days,
      label: parts.label
    };
  }

  private static client() {
    if (!env.OPENAI_API_KEY) return null;
    return new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  private static requestOptions() {
    return { timeout: env.OPENAI_REQUEST_TIMEOUT_MS, maxRetries: 0 };
  }

  private static logAIError(context: string, error: unknown) {
    if (error instanceof Error && error.name === 'APIConnectionTimeoutError') {
      console.warn(`${context} timed out after ${env.OPENAI_REQUEST_TIMEOUT_MS}ms; using fallback.`);
      return;
    }
    console.error(context, error);
  }

  static disclaimer =
    'This report is generated from caregiver-submitted observations and AI-assisted analysis. It is not a clinical diagnosis and should not replace professional pediatric evaluation.';

  private static fallbackReportNarrative(reason: string) {
    return {
      overallSummary: reason,
      domainSummaries: [],
      flagsToDiscuss: [],
      positiveHighlights: [],
      dataQualityExplanation: 'Data quality is calculated deterministically by the backend.'
    };
  }

  static async generateReportNarrative(input: unknown) {
    const client = this.client();
    if (!client) {
      return this.fallbackReportNarrative('AI summary is unavailable until OPENAI_API_KEY is configured.');
    }

    try {
      const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You provide child-development guidance only. Never diagnose autism, ADHD, disorders, disease, or medical conditions. Return valid JSON only.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Generate a development report narrative from the supplied backend scores.',
              requiredJsonShape: {
                overallSummary: 'string',
                domainSummaries: [{ domain: 'string', summary: 'string' }],
                flagsToDiscuss: [
                  {
                    domain: 'string',
                    priority: 'low | medium | high',
                    title: 'string',
                    description: 'string',
                    recommendation: 'string'
                  }
                ],
                positiveHighlights: ['string'],
                dataQualityExplanation: 'string'
              },
              input,
              disclaimer: this.disclaimer
            })
          }
        ]
      }, this.requestOptions());
      return reportSchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
    } catch (error) {
      this.logAIError('Failed to generate report narrative', error);
      return this.fallbackReportNarrative('AI summary is temporarily unavailable. The deterministic report data is still available.');
    }
  }

  static async generateObservationTextFromMedia(files: MediaAnalysisFile[]) {
    const client = this.client();
    if (!client || files.length === 0) return null;

    const generated = await Promise.all(
      files.map(async (file) => {
        try {
          if (file.mimetype.startsWith('image/')) return this.describeImage(client, file);
          if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) return this.transcribeAudio(client, file);
          return null;
        } catch (error) {
          console.error('Failed to generate observation text from media', error);
          return null;
        }
      })
    );

    return generated.filter(Boolean).join('\n\n') || null;
  }

  static async generateObservationTextFromStoredMedia(media: StoredMedia[]) {
    if (!env.OPENAI_API_KEY || media.length === 0) return null;

    const files = await Promise.all(
      media.map(async (item) => ({
        buffer: await StorageService.downloadBuffer(item.key),
        mimetype: item.mimeType,
        originalname: item.originalName ?? item.key.split('/').pop() ?? 'media'
      }))
    );

    return this.generateObservationTextFromMedia(files);
  }

  static fallbackObservationDisplay(input: { text?: string; domain?: string; indicatorTitle?: string; stage?: string; stageScore?: number }) {
    const text = input.text?.trim() || 'Observation added.';
    const title = input.indicatorTitle || `${input.domain || 'Development'} observation`;
    const description = text.length > 140 ? `${text.slice(0, 137).trim()}...` : text;
    const progress = input.stageScore ? Math.min(100, Math.max(0, input.stageScore * 25)) : 0;
    return { title, description, progress, icon: this.fallbackObservationIcon(input) };
  }

  static async generateObservationDisplay(input: { text?: string; domain?: string; indicatorTitle?: string; stage?: string; stageScore?: number }) {
    const fallback = this.fallbackObservationDisplay(input);
    const client = this.client();
    if (!client) return fallback;

    try {
      const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Create concise child-development card display fields from a caregiver observation. Return valid JSON only with title, description, progress, and icon. Do not diagnose or infer medical conditions. Title should be 2-5 words. Description should be one short sentence. Progress must be 0-100 and should align with the supplied stage. Icon must be exactly one relevant emoji, for example 🏠, 💬, 🚶, 🤝, 🎨, 📖, ⚽, 🧩, 🎵, 📷, 🎤, ⭐, or 😊.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              observation: input.text,
              domain: input.domain,
              indicatorTitle: input.indicatorTitle,
              stage: input.stage,
              suggestedProgress: fallback.progress
            })
          }
        ]
      }, this.requestOptions());

      const parsed = observationDisplaySchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
      return parsed;
    } catch (error) {
      this.logAIError('Failed to generate observation display fields', error);
      return fallback;
    }
  }

  static fallbackDomainProgressKeyword(input: DomainKeywordInput) {
    const scored = input.observations
      .map((item) => ({ score: item.stageScore ?? null, occurredAt: item.occurredAt ? new Date(item.occurredAt).getTime() : 0 }))
      .filter((item): item is { score: number; occurredAt: number } => typeof item.score === 'number')
      .sort((a, b) => a.occurredAt - b.occurredAt);

    if (scored.length === 0) return 'not-enough-data' as const;
    if (scored.length === 1) return scored[0].score >= 3 ? ('improving' as const) : ('stable' as const);

    const midpoint = Math.floor(scored.length / 2);
    const older = scored.slice(0, midpoint);
    const recent = scored.slice(midpoint);
    const average = (items: typeof scored) => items.reduce((sum, item) => sum + item.score, 0) / items.length;
    const olderAverage = average(older);
    const recentAverage = average(recent);

    if (recentAverage >= olderAverage + 0.4) return 'improving' as const;
    if (recentAverage <= olderAverage - 0.4) return 'needs-support' as const;
    return 'stable' as const;
  }

  static async generateDomainProgressKeywords(domains: DomainKeywordInput[]) {
    const fallback = domains.map((domain) => ({
      domainId: domain.domainId,
      keyword: this.fallbackDomainProgressKeyword(domain)
    }));
    const client = this.client();
    if (!client) return fallback;

    try {
      const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Choose one progress keyword for each child-development domain from caregiver observations. Return valid JSON only with domains: [{domainId, keyword}]. Allowed keywords: improving, stable, needs-support, not-enough-data. Do not diagnose or make medical claims. Use not-enough-data when there are no observations. Use needs-support only when recent observations suggest lower or stalled progress.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              domains: domains.map((domain) => ({
                domainId: domain.domainId,
                name: domain.name,
                percentage: domain.percentage,
                observationCount: domain.observationCount,
                fallbackKeyword: fallback.find((item) => item.domainId === domain.domainId)?.keyword,
                observations: domain.observations.slice(-8).map((observation) => ({
                  stage: observation.stage,
                  stageScore: observation.stageScore,
                  title: observation.title,
                  text: observation.text,
                  occurredAt: observation.occurredAt
                }))
              }))
            })
          }
        ]
      }, this.requestOptions());

      const parsed = domainProgressKeywordsSchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
      const byDomain = new Map(parsed.domains.map((item) => [item.domainId, item.keyword]));
      return fallback.map((item) => ({ ...item, keyword: byDomain.get(item.domainId) ?? item.keyword }));
    } catch (error) {
      this.logAIError('Failed to generate domain progress keywords', error);
      return fallback;
    }
  }

  static async generateObservationStatusSummary(input: ObservationStatusSummaryInput) {
    const client = this.client();
    if (!client) return input.fallback;

    try {
      const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Return a child-development observation status summary. Output valid JSON only with achieved, inProgress, and upcoming numbers. Use achieved for clearly mastered/confident items, inProgress for observed but not mastered items, and upcoming for not-yet-observed items. Do not diagnose or make medical claims. Keep totals consistent with the supplied items.'
          },
          {
            role: 'user',
            content: JSON.stringify(input)
          }
        ]
      }, this.requestOptions());

      return observationStatusSummarySchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
    } catch (error) {
      this.logAIError('Failed to generate observation status summary', error);
      return input.fallback;
    }
  }

  static fallbackDevelopmentalAgeEstimate(input: DevelopmentalAgeEstimateInput) {
    const observedDomains = input.domains.filter((domain) => typeof domain.percentage === 'number');
    const totalObservations = observedDomains.reduce((sum, domain) => sum + domain.observationCount, 0);
    if (observedDomains.length === 0 || totalObservations === 0) {
      return {
        months: null,
        label: 'Not enough data',
        confidence: 'low' as const,
        basis: 'No scored domain observations are available yet.',
        domainMatches: input.domains.map((domain) => ({
          domainId: domain.domainId,
          name: domain.name,
          estimatedMonths: null,
          note: 'No scored observations yet.'
        }))
      };
    }

    const totalWeight = observedDomains.reduce((sum, domain) => sum + Math.max(1, domain.observationCount), 0);
    const averagePercentage =
      observedDomains.reduce((sum, domain) => sum + (domain.percentage ?? 0) * Math.max(1, domain.observationCount), 0) / totalWeight;
    const adjustmentMonths = Math.round(input.chronologicalAgeMonths * ((averagePercentage - 75) / 100));
    const months = Math.max(1, Math.min(120, input.chronologicalAgeMonths + adjustmentMonths));
    const adjustmentAmount = Math.abs(adjustmentMonths);
    const adjustmentLabel = `${adjustmentAmount} month${adjustmentAmount === 1 ? '' : 's'}`;
    const confidence =
      observedDomains.length >= 3 && totalObservations >= 8 && input.ageBands.some((band) => band.observedCount >= 3)
        ? ('high' as const)
        : observedDomains.length >= 2 && totalObservations >= 4
          ? ('medium' as const)
          : ('low' as const);

    return {
      months,
      ...this.developmentalAgeParts(months),
      confidence,
      basis: `Calculated from chronological age (${input.chronologicalAgeMonths} months) ${adjustmentMonths >= 0 ? 'plus' : 'minus'} ${adjustmentLabel} based on domain progress.`,
      domainMatches: input.domains.map((domain) => ({
        domainId: domain.domainId,
        name: domain.name,
        estimatedMonths:
          typeof domain.percentage === 'number'
            ? Math.max(1, Math.min(120, input.chronologicalAgeMonths + Math.round(input.chronologicalAgeMonths * ((domain.percentage - 75) / 100))))
            : null,
        note: `${domain.observationCount} scored observation${domain.observationCount === 1 ? '' : 's'} in this domain.`
      }))
    };
  }

  static async generateDevelopmentalAgeEstimate(input: DevelopmentalAgeEstimateInput) {
    const fallback = this.fallbackDevelopmentalAgeEstimate(input);
    const client = this.client();
    if (!client) return fallback;

    try {
      const response = await client.chat.completions.create(
        {
          model: env.OPENAI_MODEL,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Estimate a child-development skill-equivalent age from caregiver observations and backend domain scores. Return valid JSON only with months, label, confidence, basis, and domainMatches. The months value must be the child chronological age plus or minus a development-progress adjustment; do not replace it with a raw age-band maximum. Use age-band evidence only to support confidence and notes. This is not a diagnosis, clinical assessment, or statement of delay. Be conservative, use null months when data is too limited, and keep the basis concise.'
            },
            {
              role: 'user',
              content: JSON.stringify({
                requiredJsonShape: {
                  months: 'number|null, 0-120',
                  years: 'number',
                  remainingMonths: 'number',
                  days: 'number',
                  label: 'string in "X years Y months Z days" format',
                  confidence: 'low|medium|high',
                  basis: 'string',
                  domainMatches: [{ domainId: 'string', name: 'string', estimatedMonths: 'number|null', note: 'string' }]
                },
                chronologicalAgeMonths: input.chronologicalAgeMonths,
                domainProgress: input.domains,
                ageBandEvidence: input.ageBands,
                recentObservations: input.recentObservations.slice(0, 30),
                fallback
              })
            }
          ]
        },
        this.requestOptions()
      );

      return this.withDevelopmentalAgeParts(developmentalAgeEstimateSchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}')));
    } catch (error) {
      this.logAIError('Failed to generate developmental age estimate', error);
      return fallback;
    }
  }

  private static fallbackObservationIcon(input: { text?: string; domain?: string; type?: string }) {
    const source = `${input.domain ?? ''} ${input.text ?? ''} ${input.type ?? ''}`.toLowerCase();
    if (/home|house|family|routine/.test(source)) return '🏠';
    if (/language|sentence|word|speak|talk|read|literacy/.test(source)) return '💬';
    if (/walk|run|jump|motor|movement|balance|climb/.test(source)) return '🚶';
    if (/share|social|friend|cooperat|help|turn/.test(source)) return '🤝';
    if (/art|paint|draw|color|creative/.test(source)) return '🎨';
    if (/book|story|letter/.test(source)) return '📖';
    if (/ball|sport|kick|throw|catch/.test(source)) return '⚽';
    if (/music|song|sing|dance/.test(source)) return '🎵';
    if (/audio|voice|microphone/.test(source)) return '🎤';
    if (/photo|image|camera|video/.test(source)) return '📷';
    if (/sort|count|number|shape|cognitive|puzzle/.test(source)) return '🧩';
    return '⭐';
  }

  private static async describeImage(client: OpenAI, file: MediaAnalysisFile) {
    const response = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Create a concise caregiver observation from an image. Describe only visible behavior or context. Do not identify people, diagnose, infer sensitive traits, or provide medical claims.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Write one short observation sentence for this child-development record.' },
            { type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` } }
          ]
        }
      ]
    }, this.requestOptions());
    return response.choices[0]?.message.content?.trim() || null;
  }

  private static async transcribeAudio(client: OpenAI, file: MediaAnalysisFile) {
    const upload = await toFile(file.buffer, file.originalname, { type: file.mimetype });
    const transcription = await client.audio.transcriptions.create(
      {
        file: upload,
        model: 'gpt-4o-mini-transcribe'
      },
      this.requestOptions()
    );
    return transcription.text.trim() || null;
  }
}
