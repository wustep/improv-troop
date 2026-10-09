import { describe, expect, it } from "vitest";
import { audioFileName } from "./Transport";

describe("saving a take as audio", () => {
  it("names the file after the take, in the format the browser recorded", () => {
    expect(audioFileName("Swing · improvised", "audio/webm;codecs=opus")).toBe("Swing · improvised · Jamming.webm");
    expect(audioFileName("Autumn Leaves · composed", "audio/mp4")).toBe("Autumn Leaves · composed · Jamming.m4a");
    expect(audioFileName('a/b: "c"?', "audio/ogg;codecs=opus")).toBe("a b c · Jamming.ogg");
    expect(audioFileName("  ", "audio/webm")).toBe("take · Jamming.webm");
  });
});
