import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // apps/api is a Python project and is verified through pytest.
    projects: ["packages/*", "apps/web", "apps/desktop"],
  },
});
