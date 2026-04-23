export type Flexibility = '+' | '-' | '+-' | '*';

type ClaimForMerge = {
  amount: number;
  flexibility: Flexibility | null;
};

export function mergeClaimPair(
  a: ClaimForMerge,
  b: ClaimForMerge,
): { amount: number; flexibility: Flexibility } {
  const fa = a.flexibility ?? '*';
  const fb = b.flexibility ?? '*';
  return {
    amount: a.amount + b.amount,
    flexibility: fa === fb ? fa : '*',
  };
}
