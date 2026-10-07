import typescriptParser from "@typescript-eslint/parser";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  { files: ["**/*.js", "**/*.mjs"], rules: { "no-console": "off" } },
  {
    files: ["**/*.ts"],
    languageOptions: { parser: typescriptParser },
    rules: { "no-console": "off" },
  },
];
