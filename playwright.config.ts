import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
	testDir: 'tests/e2e',
	workers: 1,
	fullyParallel: false,
	timeout: isCI ? 120_000 : 60_000,
	retries: isCI ? 1 : 0,
	reporter: 'html',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'setup',
			testMatch: /auth\.setup\.ts/
		},
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				channel: 'chromium',
				storageState: 'tests/e2e/.auth/user.json'
			},
			dependencies: ['setup']
		}
	],
	webServer: {
		command: 'bun run build && bun run db:migrate && bun run e2e:serve',
		port: 4173,
		reuseExistingServer: !process.env.CI
	}
});
