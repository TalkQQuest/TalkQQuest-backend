import request from "supertest";
import { createApp } from "../app";

describe("GET /api/v1/health", () => {
  it("returns the common success response shape", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.errorCode).toBeNull();
  });
});
