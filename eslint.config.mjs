import json from "@eslint/json";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "main.js",
    "*.map",
    "_local-*",
    "esbuild.config.mjs",
    "eslint.config.mjs",
    "scripts"
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"],
    rules: {
      // Declarative settings search is available in Obsidian 1.13+. Version 0.1.0
      // intentionally supports the verified 1.12.7 minimum release.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          acronyms: ["API", "OCR", "PR", "UI", "URL"],
          brands: ["Cosense", "GitHub", "Markdown", "Obsidian", "PageRank", "PalmWiki", "PalmWiki Home", "Scrapbox"],
          enforceCamelCaseLower: true,
          ignoreRegex: ["\\n"]
        }
      ]
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      // Tests run under Node.js and are never bundled into the mobile plugin.
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/prefer-window-timers": "off",
      "obsidianmd/ui/sentence-case": "off"
    }
  },
  {
    files: ["manifest.json"],
    language: "json/json",
    plugins: {
      json
    },
    rules: {
      "no-irregular-whitespace": "off",
      "obsidianmd/validate-manifest": "error"
    }
  }
);
