/**
 * A credit count, Indian-grouped — `1,000`, `−500`.
 *
 * Credits are not money on screen even though one buys a rupee's worth: the
 * balance is a count of what a company may still spend on tickets, and a ₹ in
 * front of it would read as cash on account. A real minus sign, as `money`
 * uses, because a negative balance is a normal state here.
 */
export function formatCredits(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-IN");
  return n < 0 ? `−${abs}` : abs;
}
