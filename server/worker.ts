import app from './index';

// Cloudflare Workers entry point. Static assets (the SvelteKit SPA build) are
// served by the platform via the [assets] config in wrangler.toml; only /api/*
// requests reach this handler (see run_worker_first).
export default app;
