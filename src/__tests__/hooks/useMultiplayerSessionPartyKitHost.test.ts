/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useMultiplayerSession } from "@/hooks/useRealTime";
import usePartySocket from "@/hooks/usePartySocket";
import YProvider from "y-partykit/provider";

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("mock_token_abc"),
  }),
}));

jest.mock("@/hooks/useHydrationComplete", () => ({
  useHydrationComplete: () => true,
}));

jest.mock("@/hooks/usePartySocket", () => jest.fn());

jest.mock("y-partykit/provider", () =>
  jest.fn().mockImplementation((host, room, doc, opts) => ({
    host,
    room,
    doc,
    opts,
    disconnect: jest.fn(),
  })),
);

jest.mock("yjs", () => ({
  Doc: jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
  })),
}));

describe("useMultiplayerSession PartyKit host resolution", () => {
  const originalEnv = process.env.NEXT_PUBLIC_PARTYKIT_HOST;

  afterEach(() => {
    process.env.NEXT_PUBLIC_PARTYKIT_HOST = originalEnv;
    jest.clearAllMocks();
  });

  it("uses the configured NEXT_PUBLIC_PARTYKIT_HOST for both PartySocket and YProvider", async () => {
    process.env.NEXT_PUBLIC_PARTYKIT_HOST = "partykit.worksphere.dev";

    renderHook(() => useMultiplayerSession("room_test_123"));

    // Verify usePartySocket host
    expect(usePartySocket).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "partykit.worksphere.dev",
        room: "room_test_123",
      }),
    );

    // Verify YProvider host once token resolves
    await waitFor(() => {
      expect(YProvider).toHaveBeenCalledWith(
        "partykit.worksphere.dev",
        "room_test_123",
        expect.anything(),
        expect.objectContaining({
          params: { token: "mock_token_abc" },
        }),
      );
    });
  });

  it("falls back to 127.0.0.1:1999 when NEXT_PUBLIC_PARTYKIT_HOST is unset", async () => {
    delete process.env.NEXT_PUBLIC_PARTYKIT_HOST;

    renderHook(() => useMultiplayerSession("room_fallback_456"));

    expect(usePartySocket).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1:1999",
        room: "room_fallback_456",
      }),
    );

    await waitFor(() => {
      expect(YProvider).toHaveBeenCalledWith(
        "127.0.0.1:1999",
        "room_fallback_456",
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
