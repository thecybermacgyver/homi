import { execFileSync } from "node:child_process";

const required = [
  "core",
  "migrate",
  "bootstrap",
  "calendar-migrate",
  "module-admin",
];

const environment = {
  ...process.env,
  HOMI_POSTGRES_BOOTSTRAP_PASSWORD: "validation-only",
  HOMI_MIGRATOR_DB_PASSWORD: "validation-only",
  HOMI_APP_DB_PASSWORD: "validation-only",
  HOMI_JOBS_DB_PASSWORD: "validation-only",
  HOMI_BACKUP_DB_PASSWORD: "validation-only",
  HOMI_AUTH_SECRET: "validation-only-validation-only",
  HOMI_AUTH_BASE_URL: "http://localhost",
  HOMI_MODULE_MANAGER_SECRET: "validation-only-validation-only",
};

const output = execFileSync(
  "docker",
  ["compose", "--profile", "maintenance", "config", "--format", "json"],
  { encoding: "utf8", env: environment },
);
const config = JSON.parse(output);
for (const service of required) {
  if (config.services?.[service]?.image !== "homi-core") {
    throw new Error(
      `${service} must use the freshly built homi-core image`,
    );
  }
}
console.log("PASS_MAINTENANCE_IMAGE_CONTRACT");
