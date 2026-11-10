import { writeFileSync } from 'node:fs';
import { parks } from '../../shared/parkCatalog.ts';
import { INTEGRATION_VERSION, INTEGRATION_CAPABILITIES } from '../src/integration-version.js';
import { integrationPaths } from './integration-contracts.js';
import { schemaBundle, requestSchema, contextSchema, candidateSchemas, strategySchemas, resultSchema, KINDS, qualityReviewSchema, fieldTreeImportSchema, fieldTreeRecordSchema, fieldBoundaryRecordSchema } from '../src/contracts.js';
import { s, id, timestamp } from '../src/schema.js';

function ts(schema, depth = 0) {
  if (schema.tsType) return schema.tsType;
  if (schema.anyOf) return schema.anyOf.map(x => ts(x, depth)).join(' | ');
  if (schema.enum) return schema.enum.map(JSON.stringify).join(' | ');
  if (schema.type === 'object') return `{\n${Object.entries(schema.properties).map(([k, v]) => `${'  '.repeat(depth + 1)}${k}${schema.required?.includes(k) ? '' : '?'}: ${ts(v, depth + 1)};`).join('\n')}\n${'  '.repeat(depth)}}`;
  if (schema.type === 'array') return `Array<${ts(schema.items, depth)}>`;
  return schema.type === 'integer' ? 'number' : schema.type;
}
const names = Object.fromEntries(KINDS.map(k => [k, k.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join('')]));
const progressSchema = s.obj({ runId: id, requestId: id, status: s.enum('queued', 'running'), stage: s.str(), updatedAt: timestamp });
const acceptedSchema = s.obj({ runId: id, requestId: id, status: s.enum('queued', 'running', 'succeeded', 'needs_data', 'failed') });
const header = structuredClone(strategySchemas.weather_window);
for (const key of ['kind', ...Object.keys(candidateSchemas.weather_window.properties)]) { delete header.properties[key]; header.required = header.required.filter(x => x !== key); }
const succeeded = structuredClone(resultSchema.anyOf[0]); succeeded.properties.strategy = { tsType: 'Strategy' };
const text = [
  '// Generated from src/contracts.js. Do not edit by hand. Run: node scripts/export-contracts.js',
  '// Draft based on MH 09/10 documents; not the missing original harness-v1.ts.',
  `export type Kind = ${KINDS.map(JSON.stringify).join(' | ')};`,
  `export type HarnessRequest = ${ts(requestSchema)};`, `export type ContextSnapshot = ${ts(contextSchema)};`,
  ...KINDS.map(k => `export type ${names[k]}Candidate = ${ts(candidateSchemas[k])};`),
  `export type CandidateByKind = {\n${KINDS.map(k => `  ${k}: ${names[k]}Candidate;`).join('\n')}\n};`,
  `export type StrategyHeader = ${ts(header)};`,
  'export type Strategy = { [K in Kind]: StrategyHeader & { kind: K } & CandidateByKind[K] }[Kind];',
  `export type Succeeded = ${ts(succeeded)};`,
  `export type NeedsData = ${ts(resultSchema.anyOf.at(-2))};`, `export type Failed = ${ts(resultSchema.anyOf.at(-1))};`,
  'export type HarnessResult = Succeeded | NeedsData | Failed;',
  `export type RunProgress = ${ts(progressSchema)};`, `export type RunAccepted = ${ts(acceptedSchema)};`,
  'export type RunResponse = RunProgress | HarnessResult;',
].join('\n\n') + '\n';
writeFileSync('contracts/harness-v1.ts', text);
writeFileSync('contracts/harness-v1.schema.json', JSON.stringify(schemaBundle, null, 2) + '\n');
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const response = (description, schema) => ({ description, content: { 'application/json': { schema } } });
const errorSchema = s.obj({ error: s.obj({ code: id, message: s.str(), details: s.arr(s.str()) }, ['details']) });
const errorResponses = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503].map(status => [status, response('Structured error', ref('Error'))]));
const pathId = name => ({ name, in: 'path', required: true, schema: id });
const api = {
  openapi: '3.1.0', info: { title: 'Rubber Harness Brain', version: INTEGRATION_VERSION, description: 'LLM candidates, independent validation and traceable public sources. Advisory simulation mode only; no device execution. Auth optional on loopback; bearer token required when exposed. MH contract remains a draft.' },
  servers: [{ url: 'http://127.0.0.1:4188' }], security: [{}, { ServiceToken: [] }],
  paths: {
    '/api/park-plan/{planId}': {
      get:{summary:'Read the saved park plan by ID, including its adoption state; never substitutes the latest plan',parameters:[{name:'planId',in:'path',required:true,schema:s.str({pattern:'^park-plan-[a-f0-9]+$'})},{name:'siteId',in:'query',description:'Park scope, defaulting to Hainan. A different park returns 409 SITE_MISMATCH.',schema:s.str({default:'demo-hainan'})}],responses:{200:response('Original park plan with adoption state',s.obj({plan:{type:'object',additionalProperties:true}})),...errorResponses}},
    },
    '/api/field/trees': {
      get:{summary:'Latest imported tree measurements and park/zone boundaries in one park, preserving source and observation time',parameters:[{name:'siteId',in:'query',schema:s.str()}],responses:{200:response('Field tree catalog',s.obj({siteId:id,items:s.arr(fieldTreeRecordSchema),importedCount:s.int(),boundaries:fieldBoundaryRecordSchema},['boundaries'])),...errorResponses}},
      post:{summary:'Append measured or explicitly simulated trees and/or park plus A–D zone boundaries; latest observations replace current geometry',requestBody:{required:true,content:{'application/json':{schema:fieldTreeImportSchema}}},responses:{201:response('Updated field tree catalog',s.obj({siteId:id,items:s.arr(fieldTreeRecordSchema),importedCount:s.int(),savedCount:s.int(),boundaries:fieldBoundaryRecordSchema},['boundaries'])),...errorResponses}},
    },
    '/api/automatic': {get:{summary:'Automatic pipeline status, rolling usage caps, next check and recent runs; reading does not create model calls',responses:{200:response('Automatic status',{type:'object'}),...errorResponses}}},
    '/api/automatic/control': {post:{summary:'Persist pause/resume; does not reset budget or bypass interval; current HTTP model request may finish',requestBody:{required:true,content:{'application/json':{schema:s.obj({paused:s.bool()})}}},responses:{200:response('Automatic status',{type:'object'}),...errorResponses}}},
    '/api/demo/business-data': {get:{summary:'Explicitly simulated and linked processing, inventory, orders and transport records; local demo provider only',responses:{200:response('Simulated records',{type:'object'}),...errorResponses}}},
    '/api/demo/trees/manifest': { get: { summary: 'Read the fixed Blender object-to-treeId mapping; read-only', responses: { 200: response('Fixed demo tree manifest', { type: 'object', required: ['version', 'kind', 'dataMode', 'items'], properties: { version: { type: 'string' }, kind: { type: 'string' }, dataMode: { type: 'string' }, items: { type: 'array', items: { type: 'object', required: ['objectName', 'treeId', 'label'], additionalProperties: false } } } }), ...errorResponses } } },
    '/api/demo/trees/prepare': { post: { summary: 'Explicit strategy generation. Scheduled rule preparation may preserve configured-model bindings; never called by the read-only view', requestBody: { required: true, content: { 'application/json': { schema: s.obj({ preparationId: id, treeIds: s.arr(id, { minItems: 1, maxItems: 10, uniqueItems: true }), kind: s.enum('tapping_angle', 'surface_action', 'growth_plan', 'pest_risk'), dataMode: s.enum('demo', 'mixed_demo'), generatorMode: s.enum('demo_rules', 'configured'), preserveConfigured: s.bool() }, ['treeIds', 'kind', 'dataMode', 'preserveConfigured']) } } }, responses: { 202: response('Preparation accepted', { type: 'object', additionalProperties: true }), ...errorResponses } } },
    '/api/demo/trees/{treeId}/view': { get: { summary: 'Read one tree profile and the latest explicitly prepared strategy for Blender; this endpoint is read-only', parameters: [pathId('treeId'), { name: 'kind', in: 'query', schema: { type: 'string', enum: ['tapping_angle', 'surface_action', 'growth_plan', 'pest_risk'], default: 'tapping_angle' } }, { name: 'dataMode', in: 'query', schema: { type: 'string', enum: ['demo', 'mixed_demo'], default: 'mixed_demo' } }], responses: { 200: response('Tree view and strategy status', ref('DemoTreeView')), ...errorResponses } } },
    '/api/contexts': {post:{summary:'Import a strictly typed immutable business context (maximum 2 MiB); local provider only',requestBody:{required:true,content:{'application/json':{schema:ref('ContextSnapshot')}}},responses:{201:response('Context reference',{type:'object'}),...errorResponses}}},
    '/api/sources/coverage': {get:{summary:'Meeting requirements mapped to public sources and missing business inputs',responses:{200:response('Coverage items',{type:'object'}),...errorResponses}}},
    '/api/sources/industry-context': {post:{summary:'Freeze cached industry records without collection. demo uses simulations only; mixed_demo preserves available cache and labels substitutions; offline demo/mixed_demo remain available',requestBody:{required:true,content:{'application/json':{schema:s.obj({dataMode:s.enum('demo','public','mixed_demo')},['dataMode'])}}},responses:{201:response('Context reference',{type:'object'}),...errorResponses}}},
    '/api/sources': { get: { summary: 'Public source status, normalized data, provenance and freshness; not on-site observations', responses: { 200: response('Source status and data', { type: 'object' }), ...errorResponses } } },
    '/api/sources/refresh': { post: { summary: 'Start public source collection; poll GET /api/sources; one-minute minimum refresh interval', requestBody: { required: true, content: { 'application/json': { schema: s.obj({}) } } }, responses: { 202: response('Refresh accepted', s.obj({ status: s.enum('refreshing') })), ...errorResponses } } },
    '/api/sources/snapshots/{snapshotId}': { get: { summary: 'Download archived source JSON: raw response, normalized data, source URL, hash and retrieval time', parameters: [pathId('snapshotId')], responses: { 200: response('Source snapshot attachment', { type: 'object' }), ...errorResponses } } },
    '/api/sources/contexts': { post: { summary: 'Create a tree context: default public keeps real-data gaps; mixed_demo explicitly supplies missing inputs with simulated records', requestBody: { required: true, content: { 'application/json': { schema: s.obj({ treeIds: s.arr(id, { minItems: 1, maxItems: 200, uniqueItems: true }),dataMode:s.enum('public','mixed_demo') },['dataMode']) } } }, responses: { 201: response('Stored context reference', s.obj({ siteId: id, targetSnapshotId: id, inputSnapshot: s.obj({ snapshotId: id, version: s.int() }), executionMode: s.enum('simulation'), asOf: timestamp, targetCount: s.int() })), ...errorResponses } } },
    '/health': { get: { summary: 'Service health', security: [], responses: { 200: response('Healthy', s.obj({ status: s.enum('ok'), version: s.str(), capabilities: s.arr(s.enum(...INTEGRATION_CAPABILITIES)), executionMode: s.enum('simulation') })) } } },
    '/internal/harness/runs': {
      post: { summary: 'Create/reuse a run by requestId', requestBody: { required: true, content: { 'application/json': { schema: ref('HarnessRequest') } } }, responses: { 202: response('Queued or running', ref('RunAccepted')), 200: response('Existing terminal run', ref('RunAccepted')), ...errorResponses } },
      get: { summary: 'List recent runs with filters applied before cursor pagination; includes latest failures and needs_data', parameters: [{ name: 'limit', in: 'query', schema: s.int({ minimum: 1, maximum: 100 }) }, { name: 'cursor', in: 'query', schema: s.str() }, {name:'siteId',in:'query',description:'Optional park scope; filtered before pagination. Omit to list all parks.',schema:s.enum(...Object.values(parks).flatMap(park=>[park.siteId,park.key]))}, {name:'kind',in:'query',schema:s.enum(...KINDS)}, {name:'dataMode',in:'query',schema:s.enum('demo','mixed_demo')}, {name:'generatorMode',in:'query',schema:s.enum('demo_rules','configured')}], responses: { 200: response('Run summaries', s.obj({ items: s.arr(s.obj({ runId: id, requestId: id, kind: s.enum(...KINDS), generatorMode:s.enum('demo_rules','configured'), siteId: id, status: acceptedSchema.properties.status, stage: s.str(), createdAt: timestamp, updatedAt: timestamp, attempt: s.int(), qualityReview:s.nullable(qualityReviewSchema), summary: s.nullable(s.str()) })), nextCursor: s.nullable(s.str()) })), ...errorResponses } },
    },
    '/internal/harness/runs/{runId}': { get: { summary: 'Read progress or terminal result', parameters: [pathId('runId')], responses: { 200: response('Run state', { anyOf: [ref('RunProgress'), ref('HarnessResult')] }), ...errorResponses } } },
    '/internal/harness/runs/{runId}/context': { get: { summary: 'Read projected frozen context for internal debugging', parameters: [pathId('runId')], responses: { 200: response('Context', ref('ContextSnapshot')), ...errorResponses } } },
    '/internal/harness/runs/{runId}/export': { get: { summary: 'Download terminal result as a JSON attachment', parameters: [pathId('runId')], responses: { 200: response('JSON attachment', ref('HarnessResult')), ...errorResponses } } },
    '/internal/harness/runs/{runId}/events': { get: { summary: 'Read audit events, not model chain of thought', parameters: [pathId('runId'), { name: 'after', in: 'query', schema: s.int({ minimum: 1 }) }], responses: { 200: response('Event page', { type: 'object' }), ...errorResponses } } },
    '/internal/harness/runs/{runId}/retry': { post: { summary: 'Retry transient failure, same run ID, maximum 3 attempts', parameters: [pathId('runId')], requestBody: { required: true, content: { 'application/json': { schema: s.obj({}) } } }, responses: { 202: response('Retry queued', ref('RunAccepted')), ...errorResponses } } },
    '/internal/harness/runs/{runId}/review': { post: { summary: 'Withdraw a saved strategy for business review; preserves the original result and blocks normal export', parameters: [pathId('runId')], requestBody: { required: true, content: { 'application/json': { schema: s.obj({ status: s.enum('withdrawn'), reason: s.str() }) } } }, responses: { 200: response('Updated quality review', s.obj({ runId: id, qualityReview: qualityReviewSchema })), ...errorResponses } } },
    '/internal/harness/strategies/{strategyId}': { get: { summary: 'Read persisted strategy without recomputing', parameters: [pathId('strategyId')], responses: { 200: response('Strategy', { anyOf: Object.values(strategySchemas) }), ...errorResponses } } },
  },
  components: { securitySchemes: { ServiceToken: { type: 'http', scheme: 'bearer' } }, schemas: { HarnessRequest: requestSchema, ContextSnapshot: contextSchema, HarnessResult: resultSchema, RunAccepted: acceptedSchema, RunProgress: progressSchema, Error: errorSchema,
    DemoTreeView: { type: 'object', required: ['tree', 'strategy', 'strategyStatus', 'status', 'run', 'asOf', 'checkedAt', 'strategyRoute', 'dataPolicy'], properties: {
      tree: { type: 'object', required: ['treeId'], properties: { treeId: { type: 'string' }, blockId: { type: 'string' }, profile: { type: 'string' } }, additionalProperties: true },
      strategy: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
      strategyStatus: { type: 'string', enum: ['available', 'needs_generation', 'pending', 'expired', 'withdrawn', 'needs_data', 'failed'] },
      status: { type: 'string', enum: ['not_generated', 'queued', 'running', 'succeeded', 'needs_data', 'failed'] },
      run: { anyOf: [{ type: 'object', required: ['runId', 'requestId', 'status', 'generatorMode'], properties: { runId: { type: 'string' }, requestId: { type: 'string' }, status: { type: 'string' }, stage: { type: 'string' }, updatedAt: { type: 'string', format: 'date-time' }, generatorMode: { type: 'string', enum: ['demo_rules', 'configured'] } }, additionalProperties: true }, { type: 'null' }] },
      asOf: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
      checkedAt: { type: 'string', format: 'date-time' },
      strategyRoute: { type: 'object', required: ['version', 'treeId', 'kind', 'complexity', 'executor', 'status', 'triggers', 'blockers', 'recommendedGenerator', 'reason', 'checkedAt'], properties: {
        version: { type: 'string', enum: ['strategy-route-v1'] }, treeId: { type: 'string' }, kind: { type: 'string' },
        complexity: { type: 'string', enum: ['simple', 'complex', 'blocked'] }, executor: { type: 'string', enum: ['small_brain', 'big_brain', 'blocked'] },
        status: { type: 'string', enum: ['ready', 'needs_big_brain', 'blocked'] }, triggers: { type: 'array', items: { type: 'string' } }, blockers: { type: 'array', items: { type: 'string' } },
        recommendedGenerator: { anyOf: [{ type: 'string', enum: ['demo_rules', 'configured'] }, { type: 'null' }] }, reason: { type: 'string' }, checkedAt: { type: 'string', format: 'date-time' },
      }, additionalProperties: false },
      dataPolicy: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['demo', 'mixed_demo'] }, notices: { type: 'array', items: { type: 'string' } }, substitutions: { type: 'array', items: { type: 'object', additionalProperties: true } } }, additionalProperties: true },
      missingData: { type: 'array', items: { type: 'object', additionalProperties: true } },
      error: { type: 'object', additionalProperties: true }
    } }
  } },
};
Object.assign(api.paths,integrationPaths);
writeFileSync('contracts/openapi.json', JSON.stringify(api, null, 2) + '\n');
console.log('Exported TypeScript types, JSON schema bundle and OpenAPI 3.1 contract.');
