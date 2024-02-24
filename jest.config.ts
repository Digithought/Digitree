import type { JestConfigWithTsJest } from 'ts-jest'

const jestConfig: JestConfigWithTsJest = {
  preset: "ts-jest/presets/default-esm",
  moduleNameMapper: {
    "(.+)\\.js": "$1",
  },
	testEnvironment: "node",
	verbose: true,
	testMatch: [
		"<rootDir>/src/**/*.(test).{js,jsx,ts,tsx}",
		"<rootDir>/src/**/?(*.)(spec|test).{js,jsx,ts,tsx}",
		"<rootDir>/test/**/*.{js,jsx,ts,tsx}",
	],
	//automock: true,
	//testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
}
export default jestConfig
