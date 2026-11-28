export function readDeploymentTarget(environment = process.env) {
  const target = environment.MATHGRADE_DEPLOYMENT_TARGET || "cloudflare";
  if (!["cloudflare", "sites"].includes(target)) {
    throw new Error("MATHGRADE_DEPLOYMENT_TARGET must be cloudflare or sites.");
  }
  return target;
}
