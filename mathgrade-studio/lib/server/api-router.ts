import { handleLogin } from "./product-login";
import { handleAccount } from "./product-account";
import { handleApi } from "./service";
import { handleProductApi } from "./product-service";
import { handleProductContributionRoute } from "./product-contributions";
import { productDatabase, requireProductUser, productJson } from "./product-auth";
import { HttpError } from "./validation";

/** There is one production write boundary; legacy mode switches cannot bypass it. */
export async function routeApi(request: Request): Promise<Response> {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    if (path.startsWith("product/")) {
      const productPath = path.slice("product/".length);
      if (productPath.startsWith("auth/")) return await handleLogin(request, productPath.slice(5));
      if (productPath.startsWith("account/")) return await handleAccount(request, productPath.slice(8), productDatabase());
      if (/^(contributions|premium)(\/|$)/.test(productPath)) {
        const response = await handleProductContributionRoute(request, productPath, await requireProductUser(request), productDatabase());
        return response ?? productJson({ error: "요청한 기능을 찾을 수 없습니다." }, 404);
      }
      return handleProductApi(request, productPath);
    }
    if (request.method !== "GET") {
      await requireProductUser(request);
      return productJson({ error: "이전 작업대는 기록 열람용입니다. 시험 작업공간에서 새로 제출하세요.", code: "LEGACY_READ_ONLY" }, 410);
    }
    return handleApi(request);
  } catch (error) {
    if (error instanceof HttpError) return productJson({ error: error.message, code: error.code }, error.status);
    console.error("Product operation failed", error instanceof Error ? error.message : "unknown");
    return productJson({ error: "처리 중 문제가 발생했습니다. 입력 내용을 유지하고 다시 시도하세요.", code: "OPERATION_FAILED" }, 500);
  }
}
