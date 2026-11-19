import { z } from "zod";
import { createJsonStore, createSerialQueue } from "@/features/storage";
import type { FileSystem } from "@/features/storage";
import { entrySchema } from "./log-store";

const orderSchema = z.object({
  clientOrderId: z.string(),
  entry: entrySchema.extend({ source: z.literal("feed"), outcome: z.enum(["yes", "no"]) }),
  seenPriceCents: z.number().optional(),
  eventTicker: z.string().optional(),
});

const fileSchema = z.object({
  version: z.literal(1),
  orders: z.array(orderSchema).refine((orders) =>
    new Set(orders.map((order) => order.clientOrderId)).size === orders.length
    && new Set(orders.map((order) => order.entry.intentId)).size === orders.length),
});

export type FeedOrder = z.output<typeof orderSchema>;

type OrderFile = z.output<typeof fileSchema>;

export function awaitingPaymentResult(entry: FeedOrder["entry"]): boolean {
  return entry.code === "order-in-progress" || entry.code === "debit-unconfirmed";
}

export function createFeedOrders(
  initial: readonly FeedOrder[] = [],
  save: (file: OrderFile) => Promise<void> = () => Promise.resolve(),
) {
  let orders = new Map(initial.map((order) => [order.clientOrderId, order]));
  const queue = createSerialQueue();

  async function write(order: FeedOrder): Promise<void> {
    const next = new Map(orders).set(order.clientOrderId, order);
    await save({ version: 1, orders: [...next.values()] });
    orders = next;
  }

  return {
    all: () => [...orders.values()],
    find: (clientOrderId: string) => orders.get(clientOrderId),
    findIntent: (intentId: string) => [...orders.values()].find(({ entry }) => entry.intentId === intentId),
    claim: (order: FeedOrder) => queue.run(async () => {
      const existing = orders.get(order.clientOrderId);
      if (existing) return existing;
      if ([...orders.values()].some(({ entry }) => entry.intentId === order.entry.intentId)) throw new Error("Duplicate feed intent");
      await write(order);
      return undefined;
    }),
    update: (previous: FeedOrder, next: FeedOrder) => queue.run(async () => {
      if (orders.get(previous.clientOrderId) !== previous) return false;
      await write(next);
      return true;
    }),
  };
}

export type FeedOrders = ReturnType<typeof createFeedOrders>;

export async function openFeedOrders(options: { readonly fs: FileSystem; readonly path: string }): Promise<FeedOrders> {
  const file = createJsonStore({ ...options, schema: fileSchema, empty: () => ({ version: 1 as const, orders: [] }) });
  return createFeedOrders((await file.load()).orders, file.save);
}
