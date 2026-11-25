import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

const fatigueTelemetrySchema = z.object({
  userId: z.string().optional(),
  fatigueLevel: z.union([z.number().min(0).max(10), z.string()]).optional(),
  perclos: z.number().min(0).max(100).optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { userId: authUserId } = await auth();
    if (!authUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    const parseResult = fatigueTelemetrySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid fatigue telemetry payload",
          details: parseResult.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { userId: clientUserId } = parseResult.data;

    // Prevent identity spoofing: client cannot submit on behalf of a different user
    if (clientUserId && clientUserId !== authUserId) {
      return NextResponse.json(
        { error: "Forbidden: Cannot submit telemetry for another user" },
        { status: 403 },
      );
    }

    // Data minimization: log generic ingestion acknowledgement without user identifier or raw biometric measurements
    console.log(
      "[Health API] Successfully ingested anonymized fatigue telemetry record",
    );

    return NextResponse.json({ success: true, logged: true }, { status: 200 });
  } catch (error: any) {
    console.error("[Health API] Error processing telemetry:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
