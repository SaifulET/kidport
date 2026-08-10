import OpenAI from 'openai';
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
}
