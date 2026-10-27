import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, getUserMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));
vi.mock("./context", () => ({
  getRuntimeEnv: () => ({
    supabaseUrl: "https://supabase.example.test",
    supabasePublishableKey: "publishable-test-key",
  }),
}));

import {
  readSupabaseAccessToken,
  resolveSupabaseGoogleIdentity,
  resolveSupabaseIdentity,
} from "./supabase-auth";

const userResponse = { data: { user: { id: "qa-user" } }, error: null };

function errorResponse(status?: number) {
  return { data: { user: null }, error: { status } };
}

describe("Supabase identity resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockReturnValue({ auth: { getUser: getUserMock } });
  });

  it.each([500, 502, 503, 504])("retries once on transient HTTP %s", async (status) => {
    getUserMock.mockResolvedValueOnce(errorResponse(status)).mockResolvedValueOnce(userResponse);

    await expect(resolveSupabaseIdentity("access-token")).resolves.toEqual({ id: "qa-user" });
    expect(getUserMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, undefined])(
    "does not retry a non-transient status %s",
    async (status) => {
      getUserMock.mockResolvedValueOnce(errorResponse(status));

      await expect(resolveSupabaseIdentity("access-token")).resolves.toBeNull();
      expect(getUserMock).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves network-error handling without a retry", async () => {
    getUserMock.mockRejectedValueOnce(new Error("network unavailable"));

    await expect(resolveSupabaseIdentity("access-token")).resolves.toBeNull();
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });

  it("retains Google provider identity after a transient retry", async () => {
    getUserMock.mockResolvedValueOnce(errorResponse(503)).mockResolvedValueOnce({
      data: { user: { id: "google-user", identities: [{ provider: "google" }] } },
      error: null,
    });

    await expect(resolveSupabaseGoogleIdentity("access-token")).resolves.toEqual({
      id: "google-user",
      provider: "google",
    });
    expect(getUserMock).toHaveBeenCalledTimes(2);
  });

  it("preserves bearer and session-cookie token extraction", () => {
    expect(
      readSupabaseAccessToken(
        new Request("https://kallistis.example.test", {
          headers: {
            authorization: "Bearer header-token",
            cookie: "__Host-kallistis_supabase_session=cookie-token",
          },
        }),
      ),
    ).toBe("header-token");
    expect(
      readSupabaseAccessToken(
        new Request("https://kallistis.example.test", {
          headers: { cookie: "__Host-kallistis_supabase_session=cookie%2Dtoken" },
        }),
      ),
    ).toBe("cookie-token");
  });
});
