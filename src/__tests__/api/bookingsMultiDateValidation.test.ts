/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/bookings/route";
import { prisma } from "@/lib/prisma";
import { currentUser, auth } from "@clerk/nextjs/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      create: jest.fn(),
    },
    venue: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@clerk/nextjs/server", () => ({
  currentUser: jest.fn(),
  auth: jest.fn(),
}));

describe("POST /api/bookings multi-date validation", () => {
  const mockUser = {
    id: "user_multi_date_123",
    primaryEmailAddress: {
      emailAddress: "nomad@worksphere.dev",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (currentUser as jest.Mock).mockResolvedValue(mockUser);
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: mockUser.id });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: mockUser.id,
    });
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue_abc",
      maxCapacity: 50,
    });
    (prisma.$transaction as jest.Mock).mockImplementation((promises) =>
      Promise.all(promises),
    );
    (prisma.booking.create as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ id: `booking_${data.date}`, ...data }),
    );
  });

  it("rejects multi-date requests containing duplicate dates", async () => {
    const request = new NextRequest("http://localhost:3000/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_abc",
        dates: ["2026-12-10", "2026-12-10"],
        time: "10:00",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain("Duplicate dates are not allowed");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("rejects multi-date requests with mixed duplicate dates", async () => {
    const request = new NextRequest("http://localhost:3000/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_abc",
        dates: ["2026-12-10", "2026-12-11", "2026-12-10", "2026-12-12"],
        time: "14:00",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain("Duplicate dates are not allowed");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects requests exceeding the maximum allowed dates limit (30 dates)", async () => {
    // Generate 31 unique dates
    const excessiveDates: string[] = [];
    for (let i = 1; i <= 31; i++) {
      const day = i < 10 ? `0${i}` : `${i}`;
      excessiveDates.push(`2027-01-${day}`);
    }

    const request = new NextRequest("http://localhost:3000/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_abc",
        dates: excessiveDates,
        time: "09:00",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toMatch(/Cannot book more than 30 dates/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("accepts a valid multi-date request with unique dates within limits", async () => {
    const validDates = ["2026-12-15", "2026-12-16", "2026-12-17"];
    const request = new NextRequest("http://localhost:3000/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_abc",
        dates: validDates,
        time: "11:00",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(3);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.booking.create).toHaveBeenCalledTimes(3);
  });

  it("accepts single date booking without regression", async () => {
    const request = new NextRequest("http://localhost:3000/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_abc",
        date: "2026-12-20",
        time: "15:30",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(prisma.booking.create).toHaveBeenCalledTimes(1);
  });
});
