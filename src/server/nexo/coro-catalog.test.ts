import { describe, expect, it } from "vitest";
import { CORO_EFFECTS, coroConsentParticipants, getCoroEffect, sameIdentitySet } from "./coro-catalog";

describe("Coro manifestation catalog", () => {
  it("offers the four canonical Papéis at three levels, with Bastião as Reação", () => {
    expect(CORO_EFFECTS).toHaveLength(12);
    expect(new Set(CORO_EFFECTS.map((effect) => `${effect.paper}:${effect.level}`)).size).toBe(12);
    expect(CORO_EFFECTS.filter((effect) => effect.paper === "Bastião").every((effect) => effect.actionType === "reaction")).toBe(true);
    expect(CORO_EFFECTS.filter((effect) => effect.paper !== "Bastião").every((effect) => effect.actionType === "action")).toBe(true);
  });

  it("does not authorize a Papel or level outside the catalog", () => {
    expect(getCoroEffect("Artilharia", 2)?.name).toBe("Onda dos Horizontes");
    expect(getCoroEffect("Artilharia", 4)).toBeNull();
    expect(getCoroEffect("Tecelão", 1)).toBeNull();
  });

  it("includes only explicitly selected active participants and requires the proposer", () => {
    const members = [
      { userId: "u1", memberRole: "jogador" },
      { userId: "u2", memberRole: "jogador" },
      { userId: "u3", memberRole: "mestre" },
    ];
    expect(coroConsentParticipants(members, ["u3", "u1"], "u3")).toEqual(["u1", "u3"]);
    expect(coroConsentParticipants(members, ["u1"], "u3")).toEqual([]);
    expect(coroConsentParticipants(members, ["u3", "u4"], "u3")).toEqual([]);
    expect(coroConsentParticipants([{ userId: "u1", memberRole: "mestre" }], ["u1"], "u1")).toEqual(["u1"]);
  });

  it("compares consent membership as an identity set", () => {
    expect(sameIdentitySet(["u1", "u2", "u2"], ["u2", "u1"])).toBe(true);
    expect(sameIdentitySet(["u1", "u2"], ["u1"])).toBe(false);
  });
});
