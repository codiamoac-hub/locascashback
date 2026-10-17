/* Amounts arrive from the database as exact decimal strings ("190.20"),
   already rounded to the cent by the same SQL the website reads. They are
   printed as they are, never through a float, so the card and the website
   can never disagree by a cent. */

const AMOUNT = /^(-?)(\d+)(?:\.(\d+))?$/;

/** "1234.5" → "1,234.50". Refuses anything finer than a cent rather than round it a second time. */
export function cents(value) {
  const m = AMOUNT.exec(String(value ?? '').trim());
  if (!m) throw new Error(`Not an amount: ${value}`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) throw new Error(`More precise than a cent: ${value}`);
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}.${(frac + '00').slice(0, 2)}`;
}

/** "42.31" → "−42.31%" (a drop), "-3.5" → "+3.50%" (the floor was above). */
export function drop(pct) {
  const m = AMOUNT.exec(String(pct ?? '').trim());
  if (!m) return null;
  const [, sign] = m;
  return `${sign === '-' ? '+' : '−'}${cents(String(pct).replace(/^-/, ''))}%`;
}
