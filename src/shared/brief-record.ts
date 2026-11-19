import { z } from "zod";

export const briefAuthorSchema = z.union([
  z.literal("desk"),
  z.literal("you"),
  z.object({
    agentId: z.string().min(1),
    name: z.string().min(1),
    model: z.string().min(1),
    personality: z.string().min(1),
  }),
]);

const keyNumber = z.object({ label: z.string(), value: z.string() });
const moveRow = z.object({ atMs: z.number(), points: z.number(), note: z.string() });
const upcomingRow = z.object({ atMs: z.number(), label: z.string(), importance: z.enum(["High", "Medium", "Final"]) });
const crowdRow = z.object({ label: z.string(), value: z.string() });
const sourceRow = z.object({ title: z.string(), url: z.string() });

export const briefEvidenceSchema = z.object({
  category: z.string().optional(),
  yesCentsWhenWritten: z.number().nullable(),
  bottomLine: z.string().optional(),
  estimateCents: z.number().int().min(0).max(100).nullable().optional(),
  confidence: z.enum(["Low", "Medium", "High"]).nullable().optional(),
  resolution: z.object({
    yesIf: z.string().nullable(),
    decidedBy: z.string().nullable(),
    caveat: z.string().nullable(),
  }).optional(),
  keyNumbers: z.array(keyNumber).optional(),
  moves: z.array(moveRow).optional(),
  upcoming: z.array(upcomingRow).optional(),
  crowd: z.array(crowdRow).optional(),
  sources: z.array(sourceRow).optional(),
});

export type BriefAuthor = z.output<typeof briefAuthorSchema>;
export type BriefEvidence = z.output<typeof briefEvidenceSchema>;
