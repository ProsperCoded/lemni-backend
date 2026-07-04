export function computeNextPeriodEnd(interval: string | null): string {
  const now = new Date();
  switch (interval) {
    case 'weekly':
      now.setDate(now.getDate() + 7);
      break;
    case 'yearly':
      now.setFullYear(now.getFullYear() + 1);
      break;
    default:
      now.setMonth(now.getMonth() + 1); // monthly
  }
  return now.toISOString();
}
