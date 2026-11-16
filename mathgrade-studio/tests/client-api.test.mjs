import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ApiError } from "../lib/client/api.ts";

test("API conflicts retain their status and code for revision recovery", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    error: "최신 내용을 다시 확인하세요.", code: "REVISION_CONFLICT",
  }, { status: 409 }));
  await assert.rejects(api("/api/product/submissions/example/review", { revision: 1 }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "REVISION_CONFLICT");
    assert.equal(error.message, "최신 내용을 다시 확인하세요.");
    return true;
  });
});

test("API multipart uploads leave the boundary to fetch and keep the complete form", async (t) => {
  const form = new FormData();
  form.append("files", new File(["%PDF-first"], "answer-1.pdf", { type: "application/pdf" }));
  form.append("files", new File(["%PDF-second"], "answer-2.pdf", { type: "application/pdf" }));
  form.set("payload", JSON.stringify({ question: "두 번째 풀이도 확인해 주세요." }));
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers, undefined);
    assert.equal(options.body, form);
    assert.equal(options.body.getAll("files").length, 2);
    return Response.json({ saved: true });
  });
  assert.deepEqual(await api("/api/product/submissions", form), { saved: true });
});
