import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";

const site = process.env.PUBLIC_SITE_URL || "https://draconis-systems.example";

export default defineConfig({
  site,
  output: "static",
  integrations: [preact(), sitemap()],
  markdown: {
    shikiConfig: {
      theme: "github-dark"
    }
  },
  vite: {
    build: {
      target: "es2020"
    }
  }
});
