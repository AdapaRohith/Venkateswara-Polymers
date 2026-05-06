export function formatKg(kg) {
  const numericValue = Number(kg) || 0
  if (Math.abs(numericValue) >= 1000) return `${(numericValue / 1000).toFixed(2)} tons`
  return `${numericValue.toFixed(2)} kg`
}
