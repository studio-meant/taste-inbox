import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "desktop",
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
