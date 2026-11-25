import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { View } from "@/components/flows/types";
import {
  clearOfflinePlan, offlineViewerKey, readOfflinePlanForLocation, saveOfflinePlan, setOfflineViewer,
} from "./offline-plan";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  };
}

const view = {
  wedding: { id: "wedding-one", partnerA: "Arjun", partnerB: "Meera" },
  functions: [{ title: "Sangeet", on_date: null, starts_at: "19:30:00" }],
} as View;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  setOfflineViewer(1);
  saveOfflinePlan(view);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offline wedding schedule", () => {
  it("reads the last plan from the start URL and its own deep link only", () => {
    expect(readOfflinePlanForLocation("")).toMatchObject({ title: "Arjun & Meera" });
    expect(readOfflinePlanForLocation("?wedding=wedding-one")?.schedule).toEqual([{ title: "Sangeet", time: "19:30" }]);
    expect(readOfflinePlanForLocation("?wedding=wedding-two")).toBeNull();
    expect(readOfflinePlanForLocation("?join=aabbccddee")).toBeNull();
    expect(readOfflinePlanForLocation("?join=aabbccddee&wedding=wedding-one")).toBeNull();
    expect(readOfflinePlanForLocation("")).not.toBeNull();
  });

  it("clears when the account switches or signs out and blocks an earlier tab from overwriting it", () => {
    setOfflineViewer(2);
    expect(readOfflinePlanForLocation("")).toBeNull();
    sessionStorage.setItem(offlineViewerKey, "1");
    saveOfflinePlan(view);
    expect(readOfflinePlanForLocation("")).toBeNull();
    setOfflineViewer(2);
    saveOfflinePlan(view);
    expect(readOfflinePlanForLocation("")?.viewer).toBe("2");
    setOfflineViewer(null);
    expect(readOfflinePlanForLocation("")).toBeNull();
    expect(localStorage.getItem(offlineViewerKey)).toBeNull();
  });

  it("removes the saved schedule on demand or after 24 hours", () => {
    clearOfflinePlan();
    expect(readOfflinePlanForLocation("")).toBeNull();
    saveOfflinePlan(view);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 24 * 60 * 60 * 1000);
    expect(readOfflinePlanForLocation("")).toBeNull();
    vi.restoreAllMocks();
    expect(readOfflinePlanForLocation("")).toBeNull();
  });
});
