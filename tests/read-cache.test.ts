import { expect, it, vi } from "vitest";
import { clearReadCache, getCached } from "@/lib/read-cache";

it("serves cached values within the TTL and refreshes after it", async () => {
  clearReadCache();
  const producer = vi.fn().mockResolvedValue("fresh");
  vi.spyOn(Date, "now").mockReturnValue(100_000);
  expect(await getCached("k", 10_000, producer)).toBe("fresh");
  expect(await getCached("k", 10_000, producer)).toBe("fresh");
  expect(producer).toHaveBeenCalledTimes(1);
  vi.spyOn(Date, "now").mockReturnValue(111_000);
  expect(await getCached("k", 10_000, producer)).toBe("fresh");
  expect(producer).toHaveBeenCalledTimes(2);
  vi.restoreAllMocks();
});

it("never caches producer failures", async () => {
  clearReadCache();
  let calls = 0;
  const producer = vi.fn().mockImplementation(async () => {
    calls += 1;
    if (calls === 1) throw new Error("boom");
    return "ok";
  });
  await expect(getCached("k2", 10_000, producer)).rejects.toThrow("boom");
  expect(await getCached("k2", 10_000, producer)).toBe("ok");
});
