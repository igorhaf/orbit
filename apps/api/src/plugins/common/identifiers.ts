/** Receita Federal DV calculation: alphanumeric characters map to ASCII minus 48 (official 2026 format). */
export function validCnpj(value: string): boolean {
  const cnpj = value.toUpperCase().replace(/[./\-\s]/g, "");
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj) || /^([A-Z0-9])\1+$/.test(cnpj))
    return false;
  const digit = (source: string) => {
    const weights = [2, 3, 4, 5, 6, 7, 8, 9];
    let sum = 0;
    for (let i = source.length - 1, n = 0; i >= 0; i--, n++)
      sum += (source.charCodeAt(i) - 48) * weights[n % weights.length];
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(cnpj.slice(0, 12));
  const second = digit(cnpj.slice(0, 12) + first);
  return cnpj.endsWith(`${first}${second}`);
}
