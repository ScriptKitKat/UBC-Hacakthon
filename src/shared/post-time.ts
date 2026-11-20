const TWITTER_EPOCH_MS = 1_288_834_974_657n;

export function tweetTimeMs(postId: string): number | null {
  if (!/^\d+$/u.test(postId)) return null;
  const ms = Number((BigInt(postId) >> 22n) + TWITTER_EPOCH_MS);
  if (!Number.isFinite(ms) || ms < 1_200_000_000_000 || ms > Date.now() + 86_400_000) return null;
  return ms;
}
