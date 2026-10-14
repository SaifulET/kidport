import { env } from '../config/env';
import { DailyAiInsightService } from './DailyAiInsightService';

const ONE_HOUR_MS = 60 * 60 * 1000;
let interval: NodeJS.Timeout | undefined;
let running = false;

const runRefresh = async () => {
  if (running) return;
  running = true;
  try {
    const result = await DailyAiInsightService.refreshDueInsights({ limit: 25 });
    if (result.refreshed > 0) {
      console.log(`[DailyAiInsightScheduler] refreshed ${result.refreshed}/${result.checked} due insights`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DailyAiInsightScheduler] refresh failed: ${message}`);
  } finally {
    running = false;
  }
};

export const startDailyAiInsightScheduler = () => {
  if (env.NODE_ENV === 'test' || interval) return;
  void runRefresh();
  interval = setInterval(() => void runRefresh(), ONE_HOUR_MS);
};

export const stopDailyAiInsightScheduler = () => {
  if (!interval) return;
  clearInterval(interval);
  interval = undefined;
};
