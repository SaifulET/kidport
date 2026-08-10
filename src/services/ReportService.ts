import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { Child } from '../modules/children/child.model';
import { Observation } from '../modules/observations/observation.model';
import { Report } from '../modules/reports/report.model';
import { User } from '../modules/users/user.model';
import { AppError } from '../utils/AppError';
import { weeksBetweenInclusiveFloor } from '../utils/date';
import { AIAnalysisService } from './AIAnalysisService';
import { DevelopmentScoringService } from './DevelopmentScoringService';

const hashObservationSet = (ids: string[]) => crypto.createHash('sha256').update(ids.join('|')).digest('hex');

export class ReportService {
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
      if (cached) return cached.payload;
    }

    const progress = await DevelopmentScoringService.calculateChildProgress(childId, range);
    const overallScore = DevelopmentScoringService.calculateOverallScore(progress.domains);
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
      role: user.caregiverRole ?? user.daycareRole,
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
    const payload = {
      childId,
      child: { id: child._id.toString(), fullName: child.fullName, dateOfBirth: child.dateOfBirth },
      overallScore,
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
    doc.moveDown().fontSize(12).text(`Child: ${report.child.fullName}`);
    doc.text(`Overall score: ${report.overallScore ?? 'Not enough data'}`);
    doc.text(`Total observations: ${report.totalObservations}`);
    doc.moveDown().text(report.disclaimer);
    doc.moveDown().text(report.ai.overallSummary);
    doc.end();
    return done;
  }
}
