import { defineConfig } from "vite";

export default defineConfig({
  envDir: "..",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
