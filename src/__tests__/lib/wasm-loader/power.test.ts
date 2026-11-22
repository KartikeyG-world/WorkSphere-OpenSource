import {
  initPowerWasm,
  analyzePowerDraw,
  resetStats,
  _resetWasmForTesting,
  _setLoaderForTesting,
} from "@/lib/wasm-loader/power";

describe("Issue #9520 - Concurrent WASM Initialization Lifecycle", () => {
  beforeEach(() => {
    _resetWasmForTesting();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws descriptive error when analyzePowerDraw is called before initPowerWasm", () => {
    expect(() => analyzePowerDraw(50)).toThrow(
      "WASM module not initialized. Call initPowerWasm() first.",
    );
  });

  it("shares single initialization operation across multiple concurrent successful callers", async () => {
    let loaderCallCount = 0;
    _setLoaderForTesting(async () => {
      loaderCallCount++;
      await new Promise((r) => setTimeout(r, 20));
    });

    // Launch 5 concurrent initialization requests simultaneously
    const promises = [
      initPowerWasm(),
      initPowerWasm(),
      initPowerWasm(),
      initPowerWasm(),
      initPowerWasm(),
    ];

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    // All 5 resolved without error
    results.forEach((res) => expect(res).toBeUndefined());

    // Verified loader was called only once despite 5 concurrent callers
    expect(loaderCallCount).toBe(1);

    // Verify analyzePowerDraw works immediately
    const analysis = analyzePowerDraw(45.0);
    expect(analysis).toHaveProperty("status");
    expect(analysis).toHaveProperty("movingAverage", 45.5);
    expect(analysis.rawDraw).toBe(45.0);
  });

  it("propagates failure to all concurrent callers without hanging promises or intervals", async () => {
    let loaderCallCount = 0;
    _setLoaderForTesting(async () => {
      loaderCallCount++;
      await new Promise((r) => setTimeout(r, 20));
      throw new Error("Simulated WASM load failure");
    });

    // Launch 4 concurrent initialization requests while module load fails
    const promises = [
      initPowerWasm(),
      initPowerWasm(),
      initPowerWasm(),
      initPowerWasm(),
    ];

    // All callers must reject with the exact same error
    const outcomes = await Promise.allSettled(promises);
    expect(outcomes).toHaveLength(4);

    outcomes.forEach((outcome) => {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(Error);
        expect(outcome.reason.message).toBe(
          "WASM module initialization failed",
        );
      }
    });

    // Only one initialization run occurred for all 4 callers
    expect(loaderCallCount).toBe(1);
  });

  it("permits later retry after a failed initialization without keeping rejected state", async () => {
    let shouldFail = true;
    _setLoaderForTesting(async () => {
      if (shouldFail) {
        throw new Error("Network offline during initial fetch");
      }
    });

    // 1. Initial attempt fails
    await expect(initPowerWasm()).rejects.toThrow(
      "WASM module initialization failed",
    );

    // 2. Failure resolved, retry should succeed
    shouldFail = false;
    await expect(initPowerWasm()).resolves.toBeUndefined();

    // 3. Module is now successfully ready
    const res = analyzePowerDraw(40);
    expect(res.rawDraw).toBe(40);
  });

  it("subsequent calls after successful initialization resolve immediately without re-initializing", async () => {
    let loaderCalls = 0;
    _setLoaderForTesting(async () => {
      loaderCalls++;
    });

    await initPowerWasm();
    expect(loaderCalls).toBe(1);

    // Call initPowerWasm multiple subsequent times
    await expect(initPowerWasm()).resolves.toBeUndefined();
    await expect(initPowerWasm()).resolves.toBeUndefined();
    expect(loaderCalls).toBe(1); // Still 1

    // Verify resetStats runs without throwing
    expect(() => resetStats()).not.toThrow();
  });
});
