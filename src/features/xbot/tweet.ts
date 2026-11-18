export const TWEET_LIMIT = 280;

const ELLIPSIS = "…";
const DOMAIN = /[\p{L}\p{M}\p{N}_-]+(?:[.\u3002\uff0e\uff61]\p{L}[\p{L}\p{M}\p{N}_-]*)+/gu;
const TCO_LENGTH = 23;

function characterWeight(character: string): number {
  const point = character.codePointAt(0) ?? 0;
  return point <= 0x10ff ||
    (point >= 0x2000 && point <= 0x200d) ||
    (point >= 0x2010 && point <= 0x201f) ||
    (point >= 0x2032 && point <= 0x2037)
    ? 1
    : 2;
}

function textWeight(text: string): number {
  let weight = 0;
  for (const character of text) weight += characterWeight(character);
  return weight;
}

function tweetLength(text: string): number {
  let weight = textWeight(text);
  for (const [domain] of text.matchAll(DOMAIN)) {
    weight += Math.max(0, TCO_LENGTH - textWeight(domain));
  }
  return weight;
}

function clip(text: string, limit: number): string {
  let clipped = "";
  for (const character of text) {
    const candidate = clipped + character;
    if (tweetLength(candidate) > limit) break;
    clipped = candidate;
  }
  return clipped;
}

export function fitTweet(head: string, tail: string): string {
  const room = TWEET_LIMIT - tweetLength(tail);
  if (tweetLength(head) <= room) return head + tail;
  const ellipsisWeight = tweetLength(ELLIPSIS);
  if (room < ellipsisWeight) return clip(tail, TWEET_LIMIT);
  return clip(head, room - ellipsisWeight).trimEnd() + ELLIPSIS + tail;
}
