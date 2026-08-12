import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import { env } from '../config/env';

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

export class AIAnalysisService {
  private static client() {
    if (!env.OPENAI_API_KEY) return null;
    return new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  static disclaimer =
    'This report is generated from caregiver-submitted observations and AI-assisted analysis. It is not a clinical diagnosis and should not replace professional pediatric evaluation.';

  static async generateReportNarrative(input: unknown) {
    const client = this.client();
    if (!client) {
      return {
        overallSummary: 'AI summary is unavailable until OPENAI_API_KEY is configured.',
        domainSummaries: [],
        flagsToDiscuss: [],
        positiveHighlights: [],
        dataQualityExplanation: 'Data quality is calculated deterministically by the backend.'
      };
    }

    const response = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You provide child-development guidance only. Never diagnose autism, ADHD, disorders, disease, or medical conditions. Return valid JSON matching the requested fields.'
        },
        { role: 'user', content: JSON.stringify({ input, disclaimer: this.disclaimer }) }
      ]
    });
    return reportSchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
  }

  static async generateObservationTextFromMedia(files: Express.Multer.File[]) {
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
      });

      const parsed = observationDisplaySchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
      return parsed;
    } catch (error) {
      console.error('Failed to generate observation display fields', error);
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
      });

      const parsed = domainProgressKeywordsSchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
      const byDomain = new Map(parsed.domains.map((item) => [item.domainId, item.keyword]));
      return fallback.map((item) => ({ ...item, keyword: byDomain.get(item.domainId) ?? item.keyword }));
    } catch (error) {
      console.error('Failed to generate domain progress keywords', error);
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
      });

      return observationStatusSummarySchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
    } catch (error) {
      console.error('Failed to generate observation status summary', error);
      return input.fallback;
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

  private static async describeImage(client: OpenAI, file: Express.Multer.File) {
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
    });
    return response.choices[0]?.message.content?.trim() || null;
  }

  private static async transcribeAudio(client: OpenAI, file: Express.Multer.File) {
    const upload = await toFile(file.buffer, file.originalname, { type: file.mimetype });
    const transcription = await client.audio.transcriptions.create({
      file: upload,
      model: 'gpt-4o-mini-transcribe'
    });
    return transcription.text.trim() || null;
  }
}
