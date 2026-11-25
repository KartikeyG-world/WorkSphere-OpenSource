/**
 * @jest-environment node
 */
import { POST } from "@/app/api/bookings/bundles/route";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findMany: jest.fn() },
    booking: { create: jest.fn() },
  },
}));

jest.mock("@/lib/cache/venueAvailabilityCache", () => ({
  invalidateVenueAvailability: jest.fn().mockResolvedValue(true),
  venueAvailabilityCacheKey: (venueId: string) =>
    `venue:availability:${venueId}`,
}));

describe("POST /api/bookings/bundles duration validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([
      {
        id: "venue_1",
        name: "Venue 1",
        category: "coworking",
        address: "123 Main St",
      },
      {
        id: "venue_2",
        name: "Venue 2",
        category: "cafe",
        address: "456 Market St",
      },
    ]);
    (prisma.booking.create as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ id: `booking_${data.venueId}`, ...data }),
    );
  });

  it("rejects bundle when a leg has a negative durationHours", async () => {
    const request = new NextRequest("http://localhost/api/bookings/bundles", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_1",
        date: "2026-12-01",
        legs: [
          { venueId: "venue_1", durationHours: -1 },
          { venueId: "venue_2", durationHours: 2 },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain("Invalid duration for leg at index 1");
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("rejects bundle when a leg has a duration of zero", async () => {
    const request = new NextRequest("http://localhost/api/bookings/bundles", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_1",
        date: "2026-12-01",
        legs: [
          { venueId: "venue_1", durationHours: 0 },
          { venueId: "venue_2", durationHours: 3 },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain("Invalid duration for leg at index 1");
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("rejects bundle when durationHours is NaN, non-numeric, or Infinity", async () => {
    for (const invalidDur of [
      "not-a-number",
      "Infinity",
      "-Infinity",
      null,
      NaN,
      Infinity,
      -Infinity,
    ]) {
      const request = new NextRequest("http://localhost/api/bookings/bundles", {
        method: "POST",
        body: JSON.stringify({
          userId: "user_1",
          date: "2026-12-01",
          legs: [
            { venueId: "venue_1", durationHours: invalidDur },
            { venueId: "venue_2", durationHours: 2 },
          ],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    }
  });

  it("rejects bundle when durationHours exceeds the 24-hour limit", async () => {
    const request = new NextRequest("http://localhost/api/bookings/bundles", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_1",
        date: "2026-12-01",
        legs: [
          { venueId: "venue_1", durationHours: 25 },
          { venueId: "venue_2", durationHours: 2 },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("rejects bundle when a leg is not an object or is missing venueId", async () => {
    const requestMissingVenue = new NextRequest(
      "http://localhost/api/bookings/bundles",
      {
        method: "POST",
        body: JSON.stringify({
          userId: "user_1",
          date: "2026-12-01",
          legs: [
            { durationHours: 2 },
            { venueId: "venue_2", durationHours: 2 },
          ],
        }),
      },
    );

    const res = await POST(requestMissingVenue);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("missing a valid venueId");
  });

  it("accepts valid positive durations and correctly calculates pricing and booking minutes", async () => {
    const request = new NextRequest("http://localhost/api/bookings/bundles", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_1",
        date: "2026-12-01",
        legs: [
          { venueId: "venue_1", durationHours: 3.5, startTime: "09:00" },
          { venueId: "venue_2", durationHours: 2.5, startTime: "13:00" },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    // Total hours = 3.5 + 2.5 = 6.0
    // Raw price = 6.0 * $5.0 = $30.00
    // 25% discount => $22.50
    expect(body.bundle.totalPrice).toBe(22.5);
    expect(body.bundle.legs[0].durationHours).toBe(3.5);
    expect(body.bundle.legs[1].durationHours).toBe(2.5);

    // Bookings created with duration in minutes (3.5 * 60 = 210, 2.5 * 60 = 150)
    expect(prisma.booking.create).toHaveBeenCalledTimes(2);
    expect(prisma.booking.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          venueId: "venue_1",
          duration: 210,
        }),
      }),
    );
    expect(prisma.booking.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          venueId: "venue_2",
          duration: 150,
        }),
      }),
    );
  });
});
