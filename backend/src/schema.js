import { AppError } from './errors.js';

// Small, deliberately closed subset of JSON Schema. The same schemas are exported to clients.
export const s = {
  str: (extra = {}) => ({ type: 'string', minLength: 1, maxLength: 2000, ...extra }),
  num: (extra = {}) => ({ type: 'number', ...extra }),
  int: (extra = {}) => ({ type: 'integer', minimum: 0, ...extra }),
  bool: () => ({ type: 'boolean' }),
  enum: (...values) => ({ enum: values }),
  nullable: schema => ({ anyOf: [schema, { type: 'null' }] }),
  arr: (items, extra = {}) => ({ type: 'array', items, maxItems: 1000, ...extra }),
  obj: (properties, optional = []) => ({ type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false }),
};
export const id = s.str({ maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' });
export const timestamp = s.str({ format: 'date-time' });
function isTimestamp(value) {
  const match = value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|([+-])(\d\d):(\d\d))$/);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, zone, , offsetHour, offsetMinute] = match;
  const maxDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= maxDay && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 && (zone === 'Z' || Number(offsetHour) <= 23 && Number(offsetMinute) < 60);
}
export function schemaErrors(schema, value, path = '$') {
  if (schema.anyOf) return schema.anyOf.some(x => schemaErrors(x, value, path).length === 0) ? [] : [`${path}: 不符合允许的类型`];
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: 必须为 ${schema.enum.join(' / ')}`];
  const type = schema.type;
  if (type && !(type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : typeof value === type)) return [`${path}: 需要 ${type}`];
  if (type === 'object') {
    for (const k of schema.required ?? []) if (!Object.hasOwn(value, k)) errors.push(`${path}.${k}: 缺少字段`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties[k]) errors.push(...schemaErrors(schema.properties[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: 未定义字段`);
    }
  }
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) errors.push(`${path}: 数组长度超限`);
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) errors.push(`${path}: 存在重复项`);
    value.forEach((v, i) => errors.push(...schemaErrors(schema.items, v, `${path}[${i}]`)));
  }
  if (type === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) errors.push(`${path}: 字符串长度超限`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: 格式错误`);
    if (schema.format === 'date-time' && !isTimestamp(value)) errors.push(`${path}: 需要有效且带时区的 ISO8601 时间`);
  }
  if (type === 'number' || type === 'integer') {
    if (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) errors.push(`${path}: 数值超出范围`);
  }
  return errors;
}
export function validate(schema, value, code = 'INVALID_REQUEST') {
  const errors = schemaErrors(schema, value);
  if (errors.length) throw new AppError(code, '数据未通过契约校验', 422, errors.slice(0, 24));
  return value;
}
