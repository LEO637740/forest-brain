import {invariant} from './errors.js';
import {INDUSTRY_SITE_ID} from './adapters/public-context.js';

// Server-side access rules applied to every request that carries a signed-in
// identity (and to every business request when the server requires identity).
// Writes need the role permission and a park the account belongs to; park-wide
// business reads (sales, stock, market, logistics, strategy runs) are closed to
// growers, who only see their contracted plot.
export const WRITE_RULES = [
  [/^\/api\/simulation\/operational-events(?:\/.*)?$/, 'events.write'],
  [/^\/api\/simulation\/logistics-batches(?:\/.*)?$/, 'logistics.write'],
  [/^\/api\/simulation\/sales-shipments\/[^/]+\/advance$/, 'sales.write'],
  [/^\/api\/simulation\/market-sales-plan$/, 'sales.write'],
  [/^\/api\/simulation\/(?:market|market-plan)$/, 'market.write'],
  [/^\/api\/simulation\/actions$/, 'strategy.adopt'],
  [/^\/api\/simulation\/task-receipts$/, 'tasks.write'],
  [/^\/api\/simulation\/reviews(?:\/.*)?$/, 'reviews.write'],
  [/^\/api\/field\/trees$/, 'field.import'],
  [/^\/api\/demo\/(?:trees\/prepare|contexts|scenarios\/run)$/, 'strategy.adopt'],
  [/^\/internal\/harness\/runs(?:\/.*)?$/, 'strategy.adopt'],
  [/^\/api\/contexts$/, 'strategy.adopt'],
  [/^\/api\/sources\/(?:refresh|contexts|industry-context)$/, 'strategy.adopt'],
  [/^\/api\/(?:model|automatic)\/control$/, 'cerebellum.approve'],
];
const PARK_READS = [
  /^\/api\/simulation\/(?:sales-inventory|sales-shipments|market(?:\/.*)?|market-sales-plan|logistics-batches|actions|reviews)$/,
  /^\/internal\/harness\//, /^\/api\/demo\/(?:health|business-data|scenarios)/, /^\/api\/sources/, /^\/api\/automatic$/,
];
/** Paths that stay open without a session: health, meta, login and static assets. */
export const OPEN_PATHS = [/^\/health$/, /^\/api\/meta$/, /^\/api\/auth\/(?:accounts|login|logout)$/, /^\/api\/assistant\/status$/, /^\/contracts\//];

export function checkRead(identity, path) {
  if (!identity || identity.can('site.read')) return;
  invariant(!PARK_READS.some(pattern => pattern.test(path)), 'FORBIDDEN', '胶农身份只能查看自己承包地块的资料。', 403);
}
export function writePermission(path) { return WRITE_RULES.find(([pattern]) => pattern.test(path))?.[1] ?? null; }
/** Writes here still need the role permission, but no park membership: the scope belongs to no park. */
export const parkScoped = siteId => siteId !== INDUSTRY_SITE_ID;
/** Sites a write touches, taken from the body the route will process. */
export function writeSites(path, input) {
  if (path === '/api/simulation/task-receipts') return (input?.tasks ?? []).map(task => task?.siteId ?? (task?.site ? `demo-${task.site}` : null)).filter(Boolean);
  const site = input?.siteId ?? input?.site;
  // Business services fall back to the Hainan park when no site is sent; check the same park.
  return [site ?? 'demo-hainan'];
}
