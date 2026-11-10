// Compare figures with tool values, preserving signs and explicit units.
// This is a source lookup, not verification of the answer's business meaning.
const NUMBER = /(?<![\d.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.])-?\d+(?:\.\d+)?/g;
const SKIP_AFTER = /^\s*(?:月|日|号|年|时|点|:|：\d|周年|代|轮|步|级|层|号公告|批次?)/;
const SKIP_BEFORE = /(?:第|v|V|RU|T-|20\d\d-|\d-|[A-Z]{2,})\s*$/;

function textUnit(text) {
  const unit = text.match(/^\s*(元\s*[/／]\s*(?:公斤|千克|kg|吨|t)|公斤|千克|kg\b|吨|t\b|元|%|％)/i)?.[1].replace(/\s/g, '').replace('／', '/').toLowerCase();
  if (/^元\/(公斤|千克|kg)$/.test(unit)) return 'cny/kg';
  if (/^元\/(吨|t)$/.test(unit)) return 'cny/t';
  return {公斤:'kg',千克:'kg',kg:'kg',吨:'t',t:'t',元:'cny','%':'percent','％':'percent'}[unit] ?? null;
}

function fieldUnit(key) {
  if (/CnyPer(?:Tonne|Ton)$/i.test(key)) return 'cny/t';
  if (/CnyPerKg$/i.test(key)) return 'cny/kg';
  if (/Kg(?:PerDay)?$/i.test(key)) return 'kg';
  if (/Tonnes?$/i.test(key)) return 't';
  if (/Cny$/i.test(key)) return 'cny';
  if (/Pct$|Percent$/i.test(key)) return 'percent';
  if (/Ratio$|Share$/i.test(key)) return 'ratio';
  return null;
}

function collect(value, out, depth = 0, key = '') {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'number' && Number.isFinite(value)) { out.push({value, unit:fieldUnit(key)}); return; }
  if (typeof value === 'string') {
    for (const match of value.matchAll(NUMBER)) out.push({value:Number(match[0].replaceAll(',', '')), unit:textUnit(value.slice(match.index + match[0].length))});
    return;
  }
  if (Array.isArray(value)) { for (const item of value.slice(0, 400)) collect(item, out, depth + 1); return; }
  if (typeof value === 'object') for (const [name, item] of Object.entries(value)) collect(item, out, depth + 1, name);
}

const CONVERSIONS = {'kg:t':0.001,'t:kg':1000,'cny/t:cny/kg':0.001,'cny/kg:cny/t':1000,'ratio:percent':100,'percent:ratio':0.01};
function matches(source, number, unit, decimals) {
  let value = source.value;
  if (source.unit && unit && source.unit !== unit) {
    const factor = CONVERSIONS[`${source.unit}:${unit}`];
    if (factor === undefined) return false;
    value *= factor;
  }
  // Rounding follows the precision actually written; it cannot drop a sign.
  return Math.sign(value) === Math.sign(number) && Number(value.toFixed(decimals)) === number;
}

export function traceNumbers(answer, toolData, earlierData = []) {
  const known = [], earlier = [];
  for (const data of toolData) collect(data, known);
  for (const data of earlierData) collect(data, earlier);
  const found = [];
  for (const match of String(answer ?? '').matchAll(NUMBER)) {
    const before = answer.slice(Math.max(0, match.index - 4), match.index), after = answer.slice(match.index + match[0].length);
    if (SKIP_BEFORE.test(before) || SKIP_AFTER.test(after)) continue;
    const number = Number(match[0].replaceAll(',', ''));
    if (Math.abs(number) < 2 && Number.isInteger(number)) continue;
    const unit = textUnit(after), decimals = match[0].split('.')[1]?.length ?? 0;
    const traced = known.some(source => matches(source, number, unit, decimals));
    found.push({text:match[0], value:number, unit, traced, earlier:!traced && earlier.some(source => matches(source, number, unit, decimals))});
  }
  const unique = [...new Map(found.map(item => [`${item.text}:${item.unit}`, item])).values()];
  const earlierOnly = unique.filter(item => item.earlier).map(item => item.text);
  const untraced = unique.filter(item => !item.traced && !item.earlier).map(item => item.text);
  const parts = [`回答中 ${unique.length} 个数字，${unique.length - untraced.length - earlierOnly.length} 个与本轮工具数值对应`];
  if (earlierOnly.length) parts.push(`${earlierOnly.join('、')} 与前几轮工具数值对应`);
  return {total:unique.length, traced:unique.length - untraced.length, untraced, earlier:earlierOnly,
    summary:!unique.length ? '回答中没有需要核对的数字。' : untraced.length
      ? `${parts.join('；')}；${untraced.join('、')} 未找到对应数值，请核对计算或依据。仅对照数字来源，不核验业务含义。`
      : `${parts.join('；')}（含明确单位换算和四舍五入）。仅对照数字来源，不核验业务含义。`};
}
