import { describe, expect, it } from "vitest";
import { createFakeXClient } from "./fake-client";

const mention = (id: string) => ({ id, text: "yes 2", authorHandle: "@priscilla", inReplyToId: "root" });

describe("createFakeXClient", () => {
  it("records posted replies with generated unique ids", async () => {
    const client = createFakeXClient();
    const first = await client.postReply("root", "hello");
    const second = await client.postReply("root", "again");
    expect(first).toEqual({ ok: true, value: { id: "fake-1" } });
    expect(second).toEqual({ ok: true, value: { id: "fake-2" } });
    expect(client.posted()).toEqual([
      { id: "fake-1", inReplyToId: "root", text: "hello" },
      { id: "fake-2", inReplyToId: "root", text: "again" },
    ]);
  });

  it("returns injected mentions after the cursor", async () => {
    const client = createFakeXClient();
    client.injectMention(mention("m1"));
    client.injectMention(mention("m2"));
    const all = await client.fetchMentions();
    expect(all).toEqual({ ok: true, value: { posts: [mention("m1"), mention("m2")], newestId: "m2" } });
    client.injectMention(mention("m3"));
    const later = await client.fetchMentions("m2");
    expect(later).toEqual({ ok: true, value: { posts: [mention("m3")], newestId: "m3" } });
  });

  it("returns an empty page without a cursor when nothing was injected", async () => {
    expect(await createFakeXClient().fetchMentions()).toEqual({ ok: true, value: { posts: [] } });
  });
});
