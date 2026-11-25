/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/venues/glare/route";

describe("/api/venues/glare API", () => {
  it("rejects GET request without venueId with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/venues/glare");
    const res = await GET(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("venueId is required");
  });

  it("returns 404 if venue matrix has not been submitted", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/venues/glare?venueId=non_existent_venue_123",
    );
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("submits glare matrix and retrieves full matrix", async () => {
    const venueId = "venue_glare_test_1";
    const matrix = {
      "desk-1": [
        { timestamp: 1700000000000, glareIndex: 0.2 },
        { timestamp: 1700003600000, glareIndex: 0.8 },
      ],
      "desk-2": [
        { timestamp: 1700000000000, glareIndex: 0.1 },
        { timestamp: 1700003600000, glareIndex: 0.4 },
      ],
    };

    const postReq = new NextRequest("http://localhost:3000/api/venues/glare", {
      method: "POST",
      body: JSON.stringify({
        action: "SUBMIT_MATRIX",
        venueId,
        matrix,
      }),
    });

    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);

    const getReq = new NextRequest(
      `http://localhost:3000/api/venues/glare?venueId=${venueId}`,
    );
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(200);

    const body = await getRes.json();
    expect(body.venueId).toBe(venueId);
    expect(body.matrix).toEqual(matrix);
  });

  it("safely handles empty desk time-series arrays without crashing when querying by timestamp", async () => {
    const venueId = "venue_glare_empty_desk_test";
    const matrix = {
      "desk-empty": [],
      "desk-populated": [
        { timestamp: 1700000000000, glareIndex: 0.3 },
        { timestamp: 1700003600000, glareIndex: 0.9 },
      ],
    };

    const postReq = new NextRequest("http://localhost:3000/api/venues/glare", {
      method: "POST",
      body: JSON.stringify({
        action: "SUBMIT_MATRIX",
        venueId,
        matrix,
      }),
    });

    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);

    // Query with timestamp close to second sample
    const getReq = new NextRequest(
      `http://localhost:3000/api/venues/glare?venueId=${venueId}&timestamp=1700003500000`,
    );
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(200);

    const body = await getRes.json();
    expect(body.glareData["desk-empty"]).toBeNull();
    expect(body.glareData["desk-populated"]).toEqual({
      timestamp: 1700003600000,
      glareIndex: 0.9,
    });
  });

  it("rejects invalid timestamp query parameters with 400 Bad Request", async () => {
    const venueId = "venue_glare_invalid_ts_test";
    const matrix = {
      "desk-1": [{ timestamp: 1700000000000, glareIndex: 0.5 }],
    };

    await POST(
      new NextRequest("http://localhost:3000/api/venues/glare", {
        method: "POST",
        body: JSON.stringify({ action: "SUBMIT_MATRIX", venueId, matrix }),
      }),
    );

    const invalidTimestamps = ["invalid", "abc1234", "NaN", ""];
    for (const ts of invalidTimestamps) {
      const getReq = new NextRequest(
        `http://localhost:3000/api/venues/glare?venueId=${venueId}&timestamp=${encodeURIComponent(ts)}`,
      );
      const getRes = await GET(getReq);
      expect(getRes.status).toBe(400);

      const err = await getRes.json();
      expect(err.error).toMatch(/Invalid timestamp parameter/i);
    }
  });

  it("accepts ISO-8601 string timestamps in GET queries", async () => {
    const venueId = "venue_glare_iso_ts_test";
    const isoDate = "2026-11-25T12:00:00.000Z";
    const epoch = new Date(isoDate).getTime();
    const matrix = {
      "desk-1": [
        { timestamp: epoch - 60000, glareIndex: 0.1 },
        { timestamp: epoch + 30000, glareIndex: 0.6 },
      ],
    };

    await POST(
      new NextRequest("http://localhost:3000/api/venues/glare", {
        method: "POST",
        body: JSON.stringify({ action: "SUBMIT_MATRIX", venueId, matrix }),
      }),
    );

    const getReq = new NextRequest(
      `http://localhost:3000/api/venues/glare?venueId=${venueId}&timestamp=${encodeURIComponent(isoDate)}`,
    );
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(200);

    const body = await getRes.json();
    expect(body.glareData["desk-1"].timestamp).toBe(epoch + 30000);
  });

  it("rejects invalid matrix payloads where desk value is not an array", async () => {
    const postReq = new NextRequest("http://localhost:3000/api/venues/glare", {
      method: "POST",
      body: JSON.stringify({
        action: "SUBMIT_MATRIX",
        venueId: "venue_invalid_matrix",
        matrix: {
          "desk-1": "not-an-array",
        },
      }),
    });

    const postRes = await POST(postReq);
    expect(postRes.status).toBe(400);

    const body = await postRes.json();
    expect(body.error).toContain("must contain an array");
  });
});
