import { describe, it, expect } from "vitest"
import { toCsv } from "@/lib/csv"

describe("toCsv", () => {
  it("emits just the header row for an empty rows array", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B\r\n")
  })

  it("emits a header row and one data row per entry, in column order", () => {
    const result = toCsv(["A", "B"], [{ A: "1", B: "2" }, { A: "3", B: "4" }])
    expect(result).toBe("A,B\r\n1,2\r\n3,4\r\n")
  })

  it("quotes a field containing a comma", () => {
    expect(toCsv(["Name"], [{ Name: "Smith, John" }])).toBe("Name\r\n\"Smith, John\"\r\n")
  })

  it("quotes a field containing a double quote, and doubles the internal quote", () => {
    expect(toCsv(["Note"], [{ Note: "Say \"hi\"" }])).toBe("Note\r\n\"Say \"\"hi\"\"\"\r\n")
  })

  it("quotes a field containing a newline", () => {
    expect(toCsv(["Note"], [{ Note: "line one\nline two" }])).toBe("Note\r\n\"line one\nline two\"\r\n")
  })

  it("does not quote a plain field with no special characters", () => {
    expect(toCsv(["Name"], [{ Name: "Left Wing" }])).toBe("Name\r\nLeft Wing\r\n")
  })

  it("outputs an empty string for a missing key rather than throwing", () => {
    expect(toCsv(["A", "B"], [{ A: "1" }])).toBe("A,B\r\n1,\r\n")
  })
})
