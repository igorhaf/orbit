export const SURVEY_REMINDER_INTERVALS_HOURS = [1, 6, 12, 24, 48] as const;

export function isSurveyReminderInterval(value: unknown): value is (typeof SURVEY_REMINDER_INTERVALS_HOURS)[number] {
  return typeof value === "number"
    && SURVEY_REMINDER_INTERVALS_HOURS.includes(value as (typeof SURVEY_REMINDER_INTERVALS_HOURS)[number]);
}

export function surveyReminderIsDue(closesAt: string, intervalHours: number, now = Date.now()) {
  if (!isSurveyReminderInterval(intervalHours)) return false;
  const closingTime = Date.parse(closesAt);
  return Number.isFinite(closingTime) && closingTime > now
    && closingTime <= now + intervalHours * 60 * 60 * 1000;
}
