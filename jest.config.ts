import type { Config } from "jest";

const config: Config = {
  rootDir: "src/",
  testEnvironment: "node",
  transform: {
    "^.+.tsx?$": ["ts-jest", {}],
  },
  clearMocks: true,
};

export default config;
