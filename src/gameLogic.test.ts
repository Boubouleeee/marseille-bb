import { describe, expect, it } from "vitest";
import { nextCombo, policeCount, scoreForProp, wantedStars } from "./gameLogic";

describe("arcade scoring", () => {
  it("awards each prop's value and caps the combo multiplier", () => {
    expect(scoreForProp("crate", 1)).toBe(100);
    expect(scoreForProp("parasol", 3)).toBe(525);
    expect(scoreForProp("bin", 50)).toBe(1000);
  });

  it("continues a combo only inside its time window", () => {
    expect(nextCombo(4, 2800)).toBe(5);
    expect(nextCombo(4, 2801)).toBe(1);
  });

  it("maps bounded heat to six wanted levels and arcade patrols", () => {
    expect(wantedStars(-5)).toBe(0);
    expect(wantedStars(35)).toBe(3);
    expect(wantedStars(100)).toBe(6);
    expect(policeCount(0)).toBe(0);
    expect(policeCount(1)).toBe(1);
    expect(policeCount(6)).toBe(3);
  });
});
