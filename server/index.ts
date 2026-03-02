import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth';
import catalogueRoutes from './routes/catalogue';
import orderRoutes from './routes/orders';
import itemRoutes from './routes/items';
import claimRoutes from './routes/claims';
import reconciliationRoutes from './routes/reconciliation';

export type Bindings = {
  DB: D1Database;
  CATALOGUE_BUCKET: R2Bucket;
  RESEND_API_KEY: string;
  JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

app.use('/*', cors());

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/auth', authRoutes);
app.route('/catalogues', catalogueRoutes);
app.route('/orders', orderRoutes);
app.route('/orders', itemRoutes);
app.route('/orders', claimRoutes);
app.route('/orders', reconciliationRoutes);

export default app;
export type AppType = typeof app;
