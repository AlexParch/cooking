import { describe, expect, it } from "vitest";
import { signInitData, verifyInitData } from "../src/telegram";

const token = "123456:TEST";
const fields = () => ({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AA", user: JSON.stringify({ id: 42, first_name: "Аня" }) });

describe("verifyInitData", () => {
  it("принимает корректную подпись", async () => {
    const user = await verifyInitData(await signInitData(fields(), token), token);
    expect(user?.id).toBe(42);
  });
  it("отклоняет подделку", async () => {
    const data = (await signInitData(fields(), token)).replace("42", "43");
    expect(await verifyInitData(data, token)).toBeNull();
    expect(await verifyInitData(await signInitData(fields(), "other"), token)).toBeNull();
  });
  it("отклоняет устаревшие данные", async () => {
    const old = { ...fields(), auth_date: String(Math.floor(Date.now() / 1000) - 30 * 86400) };
    expect(await verifyInitData(await signInitData(old, token), token)).toBeNull();
  });
});
