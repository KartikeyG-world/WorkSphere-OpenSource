import { NextRequest, NextResponse } from "next/server";

// Mock database for venue geometry and pre-calculated matrices
const venueGeometry: Map<string, { desks: any[]; windows: any[] }> = new Map();
const glareMatrices: Map<string, Record<string, any[]>> = new Map();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, venueId, geometry, matrix } = body;

    if (action === "UPDATE_GEOMETRY") {
      if (!venueId || !geometry || typeof geometry !== "object") {
        return NextResponse.json(
          { error: "Missing or invalid venueId or geometry" },
          { status: 400 },
        );
      }
      venueGeometry.set(venueId, geometry);
      return NextResponse.json({
        success: true,
        message: "Geometry updated. Trigger worker to recalculate matrix.",
      });
    }

    if (action === "SUBMIT_MATRIX") {
      if (
        !venueId ||
        !matrix ||
        typeof matrix !== "object" ||
        Array.isArray(matrix)
      ) {
        return NextResponse.json(
          { error: "Missing or invalid venueId or matrix" },
          { status: 400 },
        );
      }

      for (const [deskId, samples] of Object.entries(matrix)) {
        if (!Array.isArray(samples)) {
          return NextResponse.json(
            {
              error: `Desk ${deskId} must contain an array of time-series samples`,
            },
            { status: 400 },
          );
        }
      }

      glareMatrices.set(venueId, matrix);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Glare API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const venueId = req.nextUrl.searchParams.get("venueId");
  const timestamp = req.nextUrl.searchParams.get("timestamp");

  if (!venueId) {
    return NextResponse.json({ error: "venueId is required" }, { status: 400 });
  }

  const matrix = glareMatrices.get(venueId);
  if (!matrix) {
    return NextResponse.json(
      {
        message: "No glare matrix available. Geometry may not be mapped yet.",
      },
      { status: 404 },
    );
  }

  if (timestamp !== null) {
    if (!timestamp.trim()) {
      return NextResponse.json(
        { error: "Invalid timestamp parameter" },
        { status: 400 },
      );
    }

    let targetTime: number;
    if (/^-?\d+$/.test(timestamp.trim())) {
      const parsedNum = Number(timestamp.trim());
      if (!Number.isFinite(parsedNum)) {
        return NextResponse.json(
          { error: "Invalid timestamp parameter" },
          { status: 400 },
        );
      }
      targetTime = new Date(parsedNum).getTime();
    } else {
      const parsedDate = new Date(timestamp.trim());
      targetTime = parsedDate.getTime();
    }

    if (!Number.isFinite(targetTime) || isNaN(targetTime)) {
      return NextResponse.json(
        {
          error:
            "Invalid timestamp parameter. Must be a valid epoch number or ISO date string.",
        },
        { status: 400 },
      );
    }

    // Filter matrix for specific time
    const filtered: Record<string, any> = {};

    for (const [deskId, results] of Object.entries(matrix)) {
      if (!Array.isArray(results) || results.length === 0) {
        filtered[deskId] = null;
        continue;
      }

      const validSamples = (results as any[]).filter(
        (sample) =>
          sample &&
          typeof sample === "object" &&
          typeof sample.timestamp === "number" &&
          Number.isFinite(sample.timestamp),
      );

      if (validSamples.length === 0) {
        filtered[deskId] = null;
        continue;
      }

      const closest = validSamples.reduce((prev, curr) => {
        return Math.abs(curr.timestamp - targetTime) <
          Math.abs(prev.timestamp - targetTime)
          ? curr
          : prev;
      }, validSamples[0]);
      filtered[deskId] = closest;
    }

    return NextResponse.json({ venueId, timestamp, glareData: filtered });
  }

  return NextResponse.json({ venueId, matrix });
}
