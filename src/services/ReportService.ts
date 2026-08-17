import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { Child } from '../modules/children/child.model';
import { Observation } from '../modules/observations/observation.model';
import { Report } from '../modules/reports/report.model';
import { User } from '../modules/users/user.model';
import { AppError } from '../utils/AppError';
import { calculateAge, weeksBetweenInclusiveFloor } from '../utils/date';
import { developmentalAgeDisplay, type DevelopmentalAgeDisplay } from '../utils/developmentalAge';
import { AIAnalysisService } from './AIAnalysisService';
import { DevelopmentScoringService } from './DevelopmentScoringService';

const hashObservationSet = (ids: string[]) => crypto.createHash('sha256').update(ids.join('|')).digest('hex');

type Contributor = {
  userId: string;
  name: string;
  role?: string;
  observationCount: number;
};

type ReportDomain = {
  domainId: string;
  name: string;
  percentage: number | null;
  stage: string;
  observationCount: number;
  keyword: 'improving' | 'stable' | 'needs-support' | 'not-enough-data';
};

type ReportFlag = {
  domain: string;
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  recommendation: string;
};

type ReportAI = {
  overallSummary: string;
  domainSummaries: Array<{ domain: string; summary: string }>;
  flagsToDiscuss: ReportFlag[];
  positiveHighlights: string[];
  dataQualityExplanation: string;
};

type DevelopmentalAgeEstimate = {
  months: number | null;
  years?: number;
  remainingMonths?: number;
  days?: number;
  label: string;
  confidence: 'low' | 'medium' | 'high';
  basis: string;
  domainMatches?: Array<{
    domainId: string;
    name: string;
    estimatedMonths: number | null;
    note?: string;
  }>;
  calculatedAt?: Date;
  model?: string;
} | null;

type DevelopmentReportRaw = {
  childId: string;
  child: { id: string; fullName: string; dateOfBirth: Date; profileImage?: string | null };
  overallScore: number | null;
  developmentalAge?: DevelopmentalAgeEstimate;
  progress: ReportDomain[];
  reportingPeriod: { startDate: Date | null; endDate: Date | null };
  totalObservations: number;
  caregiversContributing: number;
  contributors: Contributor[];
  averageObservationsPerWeek: number;
  dataQuality: { score: number; label: string };
  ai: ReportAI;
  disclaimer: string;
  generatedAt: Date;
};

type DevelopmentReportResponse = {
  formatVersion: 'development-report-v2';
  sections: string[];
  hero: {
    childId: string;
    childName: string;
    profileImage: string | null;
    ageLabel: string;
    dateOfBirthLabel: string;
    reportingPeriodLabel: string;
    caregiversLabel: string;
    observationsLabel: string;
    overallScore: { value: number | null; label: string };
    developmentalAge: DevelopmentalAgeDisplay;
    generatedAtLabel: string;
    poweredByAI: boolean;
  };
  overallSummary: { title: string; rangeLabel: string; text: string };
  domainReports: Array<{
    domainId: string;
    domain: string;
    icon: string;
    score: number | null;
    scoreLabel: string;
    status: string;
    statusLabel: string;
    summary: string;
    observationCount: number;
    tone: string;
  }>;
  flagsToDiscuss: { count: number; countLabel: string; items: Array<ReportFlag & { priorityLabel: string; tone: string }> };
  positiveHighlights: { items: Array<{ icon: string; text: string }> };
  recommendedQuestions: { items: Array<{ number: number; question: string; sourceDomain?: string }> };
  observationData: {
    totalObservations: number;
    reportingPeriod: string;
    caregiversContributing: number;
    averageObservationsPerWeek: number;
    dataQuality: { score: number; label: string; displayLabel: string; explanation: string };
    framework: string;
    aiEngine: string;
    contributingCaregivers: Array<Contributor & { badgeLabel: string }>;
  };
};

const titleCase = (value: string) =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const formatDate = (date: Date | string | null | undefined, month: 'short' | 'long' = 'long') => {
  if (!date) return 'Not enough data';
  return new Intl.DateTimeFormat('en-US', { month, day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(date));
};

const formatPeriod = (startDate: Date | string | null, endDate: Date | string | null, month: 'short' | 'long' = 'long') => {
  if (!startDate && !endDate) return 'Not enough data';
  if (!startDate || !endDate) return formatDate(startDate ?? endDate, month);
  return `${formatDate(startDate, month)} - ${formatDate(endDate, month)}`;
};

const domainIcon = (domain: string) => {
  const value = domain.toLowerCase();
  if (/language|communication|speech|literacy/.test(value)) return 'message-circle';
  if (/motor|movement|physical/.test(value)) return 'activity';
  if (/social|emotional|relationship/.test(value)) return 'heart';
  if (/cognitive|thinking|problem/.test(value)) return 'brain';
  if (/creative|art/.test(value)) return 'palette';
  return 'sparkles';
};

const toneForScore = (score: number | null) => {
  if (score === null) return 'muted';
  if (score >= 75) return 'success';
  if (score >= 50) return 'info';
  if (score >= 35) return 'warning';
  return 'alert';
};

const statusLabel = (status: ReportDomain['keyword']) =>
  ({
    improving: 'Improving',
    stable: 'Stable',
    'needs-support': 'Needs Support',
    'not-enough-data': 'Not Enough Data'
  })[status];

const priorityTone = (priority: ReportFlag['priority']) =>
  ({ low: 'info', medium: 'warning', high: 'alert' })[priority];

const cdcFrameworkLabel = (dateOfBirth: Date | string) => {
  const months = calculateAge(new Date(dateOfBirth)).totalMonths;
  if (months <= 2) return 'CDC Learn the Signs. Act Early. - 2 month milestones';
  if (months <= 4) return 'CDC Learn the Signs. Act Early. - 4 month milestones';
  if (months <= 6) return 'CDC Learn the Signs. Act Early. - 6 month milestones';
  if (months <= 9) return 'CDC Learn the Signs. Act Early. - 9 month milestones';
  if (months <= 12) return 'CDC Learn the Signs. Act Early. - 12 month milestones';
  if (months <= 15) return 'CDC Learn the Signs. Act Early. - 15 month milestones';
  if (months <= 18) return 'CDC Learn the Signs. Act Early. - 18 month milestones';
  if (months <= 24) return 'CDC Learn the Signs. Act Early. - 24 month milestones';
  if (months <= 30) return 'CDC Learn the Signs. Act Early. - 24-30 month milestones';
  if (months <= 36) return 'CDC Learn the Signs. Act Early. - 30-36 month milestones';
  if (months <= 48) return 'CDC Learn the Signs. Act Early. - 3-4 year milestones';
  return 'CDC Learn the Signs. Act Early. - 4-5 year milestones';
};

export class ReportService {
  private static deterministicHighlights(report: DevelopmentReportRaw) {
    const strongDomains = report.progress.filter((domain) => typeof domain.percentage === 'number' && domain.percentage >= 75);
    const highlights = strongDomains.slice(0, 3).map((domain) => `Strong ${domain.name} progress with a ${domain.percentage}/100 domain score.`);

    if (report.caregiversContributing >= 2) {
      highlights.push(`Consistent caregiver input from ${report.caregiversContributing} contributors.`);
    }
    if (report.totalObservations >= 5) {
      highlights.push(`${report.totalObservations} observations provide a useful view of recent development patterns.`);
    }

    return highlights;
  }

  private static deterministicFlags(report: DevelopmentReportRaw): ReportFlag[] {
    const lowScoreFlags = report.progress
      .filter((domain) => typeof domain.percentage === 'number' && domain.percentage < 50)
      .slice(0, 3)
      .map((domain) => ({
        domain: domain.name,
        priority: domain.percentage !== null && domain.percentage < 35 ? ('medium' as const) : ('low' as const),
        title: `${domain.name} Needs Follow-Up`,
        description: `${domain.name} is currently scored at ${domain.percentage}/100 based on caregiver observations.`,
        recommendation: `Review recent ${domain.name.toLowerCase()} observations with caregivers and consider targeted practice activities.`
      }));

    if (lowScoreFlags.length > 0) return lowScoreFlags;
    if (report.totalObservations < 5) {
      return [
        {
          domain: 'Observation Data',
          priority: 'low',
          title: 'More Observations Needed',
          description: 'The report has limited observations, so trends may not represent the full development picture yet.',
          recommendation: 'Add observations across multiple days and development domains before making decisions from trends.'
        }
      ];
    }
    return [];
  }

  private static recommendedQuestions(flags: ReportFlag[]) {
    return flags.slice(0, 4).map((flag, index) => ({
      number: index + 1,
      question: `What should we do next for ${flag.title.toLowerCase()} in ${flag.domain}?`,
      sourceDomain: flag.domain
    }));
  }

  private static formatDevelopmentReport(report: DevelopmentReportRaw | DevelopmentReportResponse): DevelopmentReportResponse {
    if ('formatVersion' in report && report.formatVersion === 'development-report-v2') {
      return {
        formatVersion: report.formatVersion,
        sections: report.sections,
        hero: {
          ...report.hero,
          developmentalAge: developmentalAgeDisplay(report.hero.developmentalAge)
        },
        overallSummary: report.overallSummary,
        domainReports: report.domainReports,
        flagsToDiscuss: report.flagsToDiscuss,
        positiveHighlights: report.positiveHighlights,
        recommendedQuestions: report.recommendedQuestions,
        observationData: report.observationData
      };
    }

    const raw = report as DevelopmentReportRaw;
    const age = calculateAge(new Date(raw.child.dateOfBirth));
    const periodLabel = formatPeriod(raw.reportingPeriod.startDate, raw.reportingPeriod.endDate);
    const shortPeriodLabel = formatPeriod(raw.reportingPeriod.startDate, raw.reportingPeriod.endDate, 'short');
    const aiFlags = raw.ai.flagsToDiscuss.length > 0 ? raw.ai.flagsToDiscuss : this.deterministicFlags(raw);
    const highlights = raw.ai.positiveHighlights.length > 0 ? raw.ai.positiveHighlights : this.deterministicHighlights(raw);
    const domainSummaryByName = new Map(raw.ai.domainSummaries.map((item) => [item.domain.toLowerCase(), item.summary]));

    return {
      formatVersion: 'development-report-v2',
      sections: ['hero', 'overallSummary', 'domainReports', 'flagsToDiscuss', 'positiveHighlights', 'recommendedQuestions', 'observationData'],
      hero: {
        childId: raw.child.id,
        childName: raw.child.fullName,
        profileImage: raw.child.profileImage ?? null,
        ageLabel: `${age.totalMonths} months old`,
        dateOfBirthLabel: `DOB: ${formatDate(raw.child.dateOfBirth)}`,
        reportingPeriodLabel: shortPeriodLabel,
        caregiversLabel: `${raw.caregiversContributing} Caregiver${raw.caregiversContributing === 1 ? '' : 's'}`,
        observationsLabel: `${raw.totalObservations} Observation${raw.totalObservations === 1 ? '' : 's'}`,
        overallScore: {
          value: raw.overallScore,
          label: raw.overallScore === null ? 'Not enough data' : `${raw.overallScore}/100`
        },
        developmentalAge: developmentalAgeDisplay(raw.developmentalAge),
        generatedAtLabel: `Generated ${formatDate(raw.generatedAt)}`,
        poweredByAI: Boolean(process.env.OPENAI_API_KEY)
      },
      overallSummary: {
        title: 'Overall Summary',
        rangeLabel: periodLabel,
        text: raw.ai.overallSummary
      },
      domainReports: raw.progress.map((domain) => {
        const scoreLabel = domain.percentage === null ? 'Not enough data' : `${domain.percentage}/100`;
        return {
          domainId: domain.domainId,
          domain: domain.name,
          icon: domainIcon(domain.name),
          score: domain.percentage,
          scoreLabel,
          status: domain.keyword,
          statusLabel: statusLabel(domain.keyword),
          summary:
            domainSummaryByName.get(domain.name.toLowerCase()) ??
            `${domain.name} is ${statusLabel(domain.keyword).toLowerCase()} with ${scoreLabel} from ${domain.observationCount} observation${domain.observationCount === 1 ? '' : 's'}.`,
          observationCount: domain.observationCount,
          tone: toneForScore(domain.percentage)
        };
      }),
      flagsToDiscuss: {
        count: aiFlags.length,
        countLabel: `${aiFlags.length} item${aiFlags.length === 1 ? '' : 's'}`,
        items: aiFlags.map((flag) => ({
          ...flag,
          priorityLabel: `${flag.priority.toUpperCase()} PRIORITY`,
          tone: priorityTone(flag.priority)
        }))
      },
      positiveHighlights: {
        items: highlights.map((text, index) => ({
          icon: ['heart', 'handshake', 'search', 'chart-up', 'moon'][index] ?? 'star',
          text
        }))
      },
      recommendedQuestions: {
        items: this.recommendedQuestions(aiFlags)
      },
      observationData: {
        totalObservations: raw.totalObservations,
        reportingPeriod: periodLabel,
        caregiversContributing: raw.caregiversContributing,
        averageObservationsPerWeek: raw.averageObservationsPerWeek,
        dataQuality: {
          ...raw.dataQuality,
          displayLabel: titleCase(raw.dataQuality.label),
          explanation: raw.ai.dataQualityExplanation
        },
        framework: cdcFrameworkLabel(raw.child.dateOfBirth),
        aiEngine: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        contributingCaregivers: raw.contributors.map((contributor) => ({
          ...contributor,
          badgeLabel: contributor.role ? `${contributor.name} (${titleCase(contributor.role)})` : contributor.name
        }))
      }
    };
  }

  static dataQuality(metrics: { totalObservations: number; durationWeeks: number; contributorCount: number; domainCoverage: number }) {
    let score = 0;
    if (metrics.totalObservations >= 30) score += 35;
    else if (metrics.totalObservations >= 12) score += 25;
    else if (metrics.totalObservations >= 5) score += 15;
    if (metrics.durationWeeks >= 8) score += 25;
    else if (metrics.durationWeeks >= 3) score += 15;
    if (metrics.contributorCount >= 3) score += 20;
    else if (metrics.contributorCount >= 2) score += 12;
    score += Math.round(metrics.domainCoverage * 20);
    const label = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 35 ? 'fair' : 'poor';
    return { score, label };
  }

  static async developmentReport(childId: string, range: { startDate?: Date; endDate?: Date } = {}, regenerate = false) {
    const child = await Child.findById(childId);
    if (!child) throw new AppError('Child not found', 404);
    const filter = {
      childId,
      status: 'active',
      ...(range.startDate || range.endDate
        ? { occurredAt: { ...(range.startDate ? { $gte: range.startDate } : {}), ...(range.endDate ? { $lte: range.endDate } : {}) } }
        : {})
    };
    const observations = await Observation.find(filter).sort({ occurredAt: 1 });
    const sourceHash = hashObservationSet(observations.map((obs) => obs._id.toString()));
    if (!regenerate) {
      const cached = await Report.findOne({ childId, type: 'development', sourceHash }).sort({ generatedAt: -1 });
      if (cached) return this.formatDevelopmentReport(cached.payload as DevelopmentReportRaw | DevelopmentReportResponse);
    }

    const progress = await DevelopmentScoringService.calculateChildProgress(childId, range, { useAIKeywords: false });
    const overallScore = DevelopmentScoringService.calculateOverallScore(progress.domains);
    const developmentalAge = await DevelopmentScoringService.calculateDevelopmentalAge(childId, progress.domains);
    const first = observations[0];
    const last = observations[observations.length - 1];
    const startDate = range.startDate ?? first?.occurredAt ?? null;
    const endDate = range.endDate ?? last?.occurredAt ?? null;
    const durationWeeks = startDate && endDate ? weeksBetweenInclusiveFloor(startDate, endDate) : 1;
    const contributorIds = [...new Set(observations.map((obs) => obs.authorId.toString()))];
    const users = await User.find({ _id: { $in: contributorIds } }).select('fullName caregiverRole daycareRole');
    const contributors = users.map((user) => ({
      userId: user._id.toString(),
      name: user.fullName,
      role: user.caregiverRole ?? user.daycareRole ?? undefined,
      observationCount: observations.filter((obs) => obs.authorId.toString() === user._id.toString()).length
    }));
    const observedDomainCount = progress.domains.filter((domain) => domain.percentage !== null).length;
    const quality = this.dataQuality({
      totalObservations: observations.length,
      durationWeeks,
      contributorCount: contributors.length,
      domainCoverage: progress.domains.length ? observedDomainCount / progress.domains.length : 0
    });
    const ai = await AIAnalysisService.generateReportNarrative({
      child: { fullName: child.fullName, dateOfBirth: child.dateOfBirth },
      deterministicScores: progress.domains,
      totalObservations: observations.length,
      contributors,
      dataQuality: quality
    });
    const profilePhoto = child.profilePhoto as { url?: string } | string | null | undefined;
    const rawPayload: DevelopmentReportRaw = {
      childId,
      child: {
        id: child._id.toString(),
        fullName: child.fullName,
        dateOfBirth: child.dateOfBirth,
        profileImage: typeof profilePhoto === 'string' ? profilePhoto : profilePhoto?.url ?? null
      },
      overallScore,
      developmentalAge,
      progress: progress.domains,
      reportingPeriod: { startDate, endDate },
      totalObservations: observations.length,
      caregiversContributing: contributors.length,
      contributors,
      averageObservationsPerWeek: Math.round((observations.length / durationWeeks) * 10) / 10,
      dataQuality: quality,
      ai,
      disclaimer: AIAnalysisService.disclaimer,
      generatedAt: new Date()
    };
    const payload = this.formatDevelopmentReport(rawPayload);
    await Report.create({
      childId,
      startDate,
      endDate,
      sourceObservationIds: observations.map((obs) => obs._id),
      sourceHash,
      model: process.env.OPENAI_MODEL,
      payload,
      disclaimerVersion: '2026-08-10'
    });
    return payload;
  }

  static async developmentReportPdf(childId: string) {
    const report = await this.developmentReport(childId);
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    doc.fontSize(20).text('Kidport Development Report');
    doc.moveDown().fontSize(12).text(`Child: ${report.hero.childName}`);
    doc.text(`Overall score: ${report.hero.overallScore.label}`);
    doc.text(`Developmental age: ${report.hero.developmentalAge?.label ?? 'Not enough data'}`);
    doc.text(`Total observations: ${report.observationData.totalObservations}`);
    doc.moveDown().text(AIAnalysisService.disclaimer);
    doc.moveDown().text(report.overallSummary.text);
    doc.end();
    return done;
  }
}
