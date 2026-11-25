/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/health/fatigue/route";
import { auth } from "@clerk/nextjs/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

describe("POST /api/health/fatigue", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("returns 401 Unauthorized if user is not authenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const req = new NextRequest("http://localhost:3000/api/health/fatigue", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_test_unauth",
        fatigueLevel: 3,
        perclos: 0.15,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("returns 403 Forbidden if client supplies a mismatched userId (identity spoofing)", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "user_legitimate_session",
    });

    const req = new NextRequest("http://localhost:3000/api/health/fatigue", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_spoofed_victim",
        fatigueLevel: 4,
        perclos: 0.22,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toContain("Forbidden");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("returns 400 Bad Request on malformed JSON payload", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "user_session_123",
    });

    const req = new NextRequest("http://localhost:3000/api/health/fatigue", {
      method: "POST",
      body: "{ not a json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 400 Bad Request on invalid PERCLOS range", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "user_session_123",
    });

    const req = new NextRequest("http://localhost:3000/api/health/fatigue", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_session_123",
        fatigueLevel: 5,
        perclos: 150, // exceeds max 100
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid fatigue telemetry payload");
  });

  it("successfully ingests telemetry and enforces data minimization in application logs", async () => {
    const authUserId = "user_wellness_member_456";
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: authUserId });

    const req = new NextRequest("http://localhost:3000/api/health/fatigue", {
      method: "POST",
      body: JSON.stringify({
        userId: authUserId,
        fatigueLevel: 2,
        perclos: 0.08,
        timestamp: Date.now(),
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.logged).toBe(true);

    // Verify data minimization: log statement must NOT leak user ID or biometric measurements
    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = logSpy.mock.calls[0][0];
    expect(loggedMessage).not.toContain(authUserId);
    expect(loggedMessage).not.toContain("PERCLOS: 0.08");
    expect(loggedMessage).not.toContain("Level: 2");
    expect(loggedMessage).toContain("anonymized");
  });

  it("successfully ingests telemetry when userId is omitted from body (derived from session)", async () => {
    const authUserId = "user_implicit_session_789";
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: authUserId });

    const req = new NextRequest("http://localhost:3000/api/health/fatigue", {
      method: "POST",
      body: JSON.stringify({
        fatigueLevel: 1,
        perclos: 0.05,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
