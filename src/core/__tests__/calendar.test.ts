import { describe, expect, it } from "vitest";
import { easterSunday, holidays, isMarketOpen, madridDate, sessionFor, zonedTimeToUtc } from "../calendar";

const closedDays = (market: Parameters<typeof holidays>[0], year: number) =>
  [...holidays(market, year)].filter(([, r]) => r.closed).map(([d]) => d).sort();

describe("calendario", () => {
  it("calcula la Pascua", () => {
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
  });

  it("festivos NYSE 2026 y 2027 coinciden con el calendario oficial", () => {
    expect(closedDays("US", 2026)).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
      "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ]);
    expect(closedDays("US", 2027)).toEqual([
      "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
      "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
    ]);
    expect(holidays("US", 2026).get("2026-11-27")).toEqual({ earlyClose: [13, 0] });
  });

  it("festivos Xetra y Euronext", () => {
    expect(closedDays("XETRA", 2026)).toEqual([
      "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31",
    ]);
    expect(closedDays("EURONEXT", 2026)).toEqual(["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-25", "2026-12-26"]);
  });

  it("convierte hora local a UTC con horario de verano", () => {
    expect(zonedTimeToUtc(2026, 7, 1, 9, 30, "America/New_York").toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 1, 9, 30, "America/New_York").toISOString()).toBe("2026-12-01T14:30:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 1, 9, 0, "Europe/Berlin").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("abre y cierra EE. UU. en su horario", () => {
    expect(isMarketOpen("US", new Date("2026-10-19T13:29:00Z"))).toBe(false);
    expect(isMarketOpen("US", new Date("2026-10-19T13:30:00Z"))).toBe(true);
    expect(isMarketOpen("US", new Date("2026-10-19T19:59:00Z"))).toBe(true);
    expect(isMarketOpen("US", new Date("2026-10-19T20:00:00Z"))).toBe(false);
  });

  it("semana de desfase de horario de verano EU/EE. UU. (abre a las 14:30 de Madrid)", () => {
    const t = new Date("2026-10-26T13:45:00Z");
    expect(isMarketOpen("US", t)).toBe(true);
    expect(madridDate(t)).toBe("2026-10-26");
  });

  it("cerrado en fin de semana y festivos", () => {
    expect(isMarketOpen("US", new Date("2026-10-17T15:00:00Z"))).toBe(false); // sábado
    expect(isMarketOpen("XETRA", new Date("2026-12-24T10:00:00Z"))).toBe(false);
    expect(sessionFor("US", new Date("2026-11-26T15:00:00Z"))).toBeNull();
  });

  it("aplica cierres anticipados", () => {
    expect(isMarketOpen("EURONEXT", new Date("2026-12-24T12:00:00Z"))).toBe(true);
    expect(isMarketOpen("EURONEXT", new Date("2026-12-24T13:10:00Z"))).toBe(false);
    expect(sessionFor("US", new Date("2026-11-27T15:00:00Z"))!.close.toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });

  it("Xetra y BME abiertos en horario europeo", () => {
    const t = new Date("2026-10-19T08:00:00Z"); // 10:00 en Berlín/Madrid
    expect(isMarketOpen("XETRA", t)).toBe(true);
    expect(isMarketOpen("BME", t)).toBe(true);
    expect(isMarketOpen("US", t)).toBe(false);
  });

  it("cripto siempre abierto", () => {
    expect(isMarketOpen("CRYPTO", new Date("2026-10-17T03:00:00Z"))).toBe(true);
  });
});
