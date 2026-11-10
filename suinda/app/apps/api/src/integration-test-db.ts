import { execFileSync } from "node:child_process";

/** Resolve the privileged connection used only to create/drop disposable schemas. */
export function integrationAdminUrl(target: URL): URL {
  const configured = process.env.ORBIT_TEST_DB_ADMIN_URL;
  if (configured) {
    const admin = new URL(configured);
    if (admin.hostname !== target.hostname || admin.port !== target.port || admin.pathname !== target.pathname) {
      throw new Error("A conexão administrativa precisa apontar para o mesmo host, porta e banco dos testes.");
    }
    return admin;
  }

  const container = process.env.ORBIT_TEST_DB_CONTAINER || "orbit-db-dev";
  const admin = new URL(target);
  admin.username = execFileSync("docker", ["exec", container, "printenv", "POSTGRES_USER"], { encoding: "utf8" }).trim();
  admin.password = execFileSync("docker", ["exec", container, "printenv", "POSTGRES_PASSWORD"], { encoding: "utf8" }).trim();
  return admin;
}
