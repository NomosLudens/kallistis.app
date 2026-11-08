import { describe, expect, it } from "vitest";
import { OST_CATALOG } from "./ost-catalog";

describe("catálogo da OST KALLISTIS", () => {
  it("contém as 32 faixas curadas, com IDs únicos", () => {
    expect(OST_CATALOG).toHaveLength(32);
    expect(new Set(OST_CATALOG.map((track) => track.id)).size).toBe(32);
    expect(
      OST_CATALOG.every((track) =>
        track.src.startsWith("https://kallistis.app/audio/ost/") ||
        track.src.startsWith("/audio/ost/"),
      ),
    ).toBe(true);
  });

  it("aponta cada faixa curada para seu asset versionado", () => {
    expect(OST_CATALOG.every((track) => track.src.includes("?v=curated-1263d115"))).toBe(true);
    expect(OST_CATALOG.map((track) => track.title)).toContain("Kaline");
    expect(OST_CATALOG.map((track) => track.title)).toContain("KALLISTIS — Trailer");
  });

  it("mantém títulos e categorias da curadoria", () => {
    expect(OST_CATALOG.find((track) => track.id === "kaline")).toMatchObject({
      title: "Kaline",
      category: "Exploração, ambiente e contemplação",
    });
    expect(OST_CATALOG.find((track) => track.id === "ritual-de-ferro")).toMatchObject({
      title: "Ritual de Ferro",
      category: "Combate",
    });
  });

  it("mantém ação explícita e sem autoplay", () => {
    expect(
      OST_CATALOG.every(
        (track) => track.autoplayAllowed === false && track.explicitUserActionRequired === true,
      ),
    ).toBe(true);
  });
});
