import { z } from "zod";

export const postResponse = z.object({ data: z.object({ id: z.string().min(1) }) });

const mentionPost = z.object({
  id: z.string().regex(/^\d+$/u),
  text: z.string(),
  author_id: z.string().optional(),
  created_at: z.string().optional(),
  referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
});

export const mentionsResponse = z.object({
  data: z.array(mentionPost).optional(),
  includes: z.object({ users: z.array(z.object({ id: z.string(), username: z.string() })).optional() }).optional(),
  meta: z.object({ newest_id: z.string().optional() }).optional(),
});

export type MentionsResponse = z.output<typeof mentionsResponse>;
