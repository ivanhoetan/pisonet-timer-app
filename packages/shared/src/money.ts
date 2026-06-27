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
