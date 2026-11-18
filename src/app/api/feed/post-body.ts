import { z } from "zod";

export const postBody = z.object({
  postId: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(2000),
  author: z.string().trim().min(1).max(100).optional(),
  url: z.url().optional(),
});

export type PostBody = z.output<typeof postBody>;

export function toPostInput({ postId, text, author }: PostBody) {
  return { id: postId, text, ...(author ? { author } : {}) };
}
