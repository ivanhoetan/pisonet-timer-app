// Pricing: 1 peso buys 5 minutes of computer time.
export const MINUTES_PER_PESO = 5;

export function pesosToMinutes(pesos: number): number {
  return Math.round(pesos * MINUTES_PER_PESO);
}

export function minutesToPesos(minutes: number): number {
  return minutes / MINUTES_PER_PESO;
}

export function formatPesos(amount: number): string {
  return `\u20b1${amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

// Loyalty stamp card: every PESOS_PER_STAMP paid (1 hour of play) earns a stamp;
// every STAMPS_PER_REWARD stamps redeems for REWARD_MINUTES of free time.
export const PESOS_PER_STAMP = 12;
export const STAMPS_PER_REWARD = 5;
export const REWARD_MINUTES = 60;

// Whole rewards a stamp balance can currently redeem.
export function rewardsAvailable(stamps: number): number {
  return Math.floor(stamps / STAMPS_PER_REWARD);
}
