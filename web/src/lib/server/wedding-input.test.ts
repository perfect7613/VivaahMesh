import { describe, expect, it, vi } from "vitest";
import { jsonObject } from "./request-body";
import { dateField, integerField, stringList, textField, uuidField, visibilityField } from "./wedding-input";

vi.mock("server-only", () => ({}));
vi.mock("./weddings", () => ({
  HttpError: class extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

function request(body: BodyInit, headers?: HeadersInit) {
  return new Request("https://example.test", { method: "POST", body, headers });
}

describe("bounded JSON", () => {
  it.each(["null", "[]", "{", "true"])("rejects bodies other than JSON objects (%s)", async (body) => {
    await expect(jsonObject(request(body))).rejects.toMatchObject({ status: 400, message: "invalid_json" });
  });

  it("rejects oversized bodies before parsing with or without a content length", async () => {
    const body = JSON.stringify({ note: "🌼".repeat(10) });
    await expect(jsonObject(request(body, { "Content-Length": "50000" }), 32)).rejects.toMatchObject({ status: 413 });
    await expect(jsonObject(request(body), 32)).rejects.toMatchObject({ status: 413 });
  });

  it("accepts a localized JSON object", async () => {
    await expect(jsonObject(request('{"note":"नमस्कार 🌼"}'))).resolves.toEqual({ note: "नमस्कार 🌼" });
  });
});

describe("onboarding inputs", () => {
  it("rejects invalid calendar dates while preserving leap dates and blank values", () => {
    expect(dateField({ date: "2028-02-29" }, "date")).toBe("2028-02-29");
    expect(dateField({ date: null }, "date")).toBeNull();
    expect(() => dateField({ date: "2027-02-29" }, "date")).toThrow("bad_date");
  });

  it("rejects unsafe database values", () => {
    expect(() => textField({ note: "a\u0000b" }, "note")).toThrow("bad_note");
    expect(() => textField({ note: "\ud83c" }, "note")).toThrow("bad_note");
    expect(() => integerField({ guests: 5001 }, "guests", 1, 5000)).toThrow("bad_guests");
    expect(() => integerField({ budget: 1e20 }, "budget", 0, Number.MAX_SAFE_INTEGER)).toThrow("bad_budget");
    expect(() => uuidField({ id: "invalid" }, "id")).toThrow("bad_id");
  });

  it("caps list work and rejects malformed entries within the supported limit", () => {
    expect(stringList({ functions: ["Haldi", "Roka", "Reception"] }, "functions", 2)).toEqual(["Haldi", "Roka"]);
    expect(() => stringList({ functions: ["Haldi", {}] }, "functions", 2)).toThrow("bad_functions");
  });

  it("does not silently turn an invalid privacy setting into a shared note", () => {
    expect(visibilityField({ visibility: "household" })).toBe("household");
    expect(() => visibilityField({ visibility: "private" })).toThrow("bad_visibility");
  });
});
