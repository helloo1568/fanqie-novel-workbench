import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("API error normalization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves status and path for a non-JSON API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Gateway", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "Content-Type": "text/plain" },
    })));

    await expect(api("/broken")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      path: "/broken",
      message: "Bad Gateway",
    });
  });

  it("normalizes a network failure without hiding its message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(api("/offline")).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
      path: "/offline",
      message: "Failed to fetch",
    });
  });
});
