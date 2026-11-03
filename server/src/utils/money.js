// Store currency as integer thebe. BWP 1.00 = 100 thebe.
export function toThebe(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Amount must be a non-negative number');
  return Math.round((n + Number.EPSILON) * 100);
}
export function fromThebe(value = 0) {
  return Number((Number(value || 0) / 100).toFixed(2));
}
export function formatBWP(thebe = 0) {
  return `BWP ${fromThebe(thebe).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
