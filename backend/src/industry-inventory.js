// A bounded check for explicit stock claims in supported inventory records.
// This is not a general natural-language fact checker; other claims still require review.
export function inventoryClaimErrors(candidate, records) {
  const inventories = records.filter(r => r.topic === 'inventory').flatMap(r => {
    try {
      const data = JSON.parse(r.content);
      if (data.unit !== 'kg_dry_rubber' || !Array.isArray(data.items) || !data.items.length ||
          !data.items.every(i => typeof i.batchId === 'string' && Number.isFinite(i.availableKg) && i.availableKg >= 0)) return [];
      return [{sourceId:r.observationId, items:data.items}];
    } catch { return []; }
  });
  const blocks = [
    {text:candidate.summary,refs:candidate.evidenceRefs},
    ...candidate.reasons.map(r => ({text:r.text,refs:r.sourceRefs})),
    ...candidate.proposal.findings.flatMap(f => [f.assessment,f.limitation].map(text => ({text,refs:f.sourceRefs}))),
    ...candidate.proposal.recommendations.flatMap(r => [r.action,r.reason].map(text => ({text,refs:r.sourceRefs}))),
    {text:candidate.proposal.uncertainty,refs:candidate.evidenceRefs},
  ];
  const errors = [];
  const quantity = '(\\d+(?:\\.\\d+)?)\\s*(kg(?:_dry_rubber)?|千克|公斤|吨|tonnes?|t)(?![A-Za-z])';
  const prefixes = [
    ['availableKg', '可用库存', '(?:可用库存(?:量)?|可售库存(?:量)?|库存可用量|可用量|available\\s+(?:inventory|stock))'],
    ['onHandKg', '在库量', '(?:在库库存|在库量|在库|库存总量|总库存)'],
    ['reservedKg', '预留量', '(?:已预留库存|预留库存|预留量|已预留)'],
    ['heldKg', '质检冻结量', '(?:质检冻结量|质检冻结库存|冻结库存|冻结量|质检冻结)'],
  ];
  const connector = '\\s*(?:为|有|约|仅|共|合计|总计|是|[:：=]|\\s){0,12}';
  const patterns = prefixes.map(([field, label, prefix]) => ({field, label, regex:new RegExp(prefix + connector + quantity, 'gi')}));
  patterns.push({field:'availableKg', label:'可用库存', regex:new RegExp('库存\\s*' + quantity + '\\s*可用', 'gi')},
    {field:'availableKg', label:'可用库存', regex:new RegExp(quantity + '\\s*(?:的)?可用库存', 'gi')});
  const namedBatch = (text, name) => text.includes(name) && !new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Za-z0-9_-]`).test(text);
  for (const {text,refs} of blocks) {
    const cited = inventories.filter(row => refs.includes(row.sourceId));
    const items = cited[0]?.items ?? [];
    for (const sentence of text.normalize('NFKC').replace(/(?<!\d)\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)/g, n => n.replaceAll(',', '')).split(/[。；;\n]/)) {
    let scope = [];
    for (const clause of sentence.split(/[，,]/)) {
      const named = items.filter(i => namedBatch(clause,i.batchId) || namedBatch(clause,i.batchId.replace(/^SIM-/, '')));
      if (named.length) scope = named;
      if (/企业.*(?:合计|总计)|(?:企业|全部|所有)(?:可用|可售|在库|预留|冻结|库存)|库存(?:合计|总计|总量)/.test(clause)) scope = [];
      for (const {field, label, regex} of patterns) for (const match of clause.matchAll(regex)) {
        // Negative/comparative instructions are not positive inventory assertions.
        const prefix = clause.slice(Math.max(0, match.index - 16), match.index);
        if (/(?:不能当作|不能说成|不能称为|不等于|并非|不是|不应称为)\s*$/.test(prefix)) continue;
        if (!cited.length) { errors.push('库存数量断言必须在该段引用有对应批次字段的库存记录，不能用天气、加工或其他无关来源替代'); continue; }
        if (cited.length !== 1) { errors.push('引用多份库存快照，尚无聚合口径，不能发布库存合计数值'); continue; }
        const batchIds = [...clause.matchAll(/\b(?:SIM-)?B\d{2,}\b/g)].map(m => m[0]);
        if (batchIds.some(id => !items.some(i => id === i.batchId || id === i.batchId.replace(/^SIM-/, '')))) { errors.push('库存断言包含引用记录中不存在的批次'); continue; }
        const selected = scope.length ? scope : items;
        if (selected.some(item => !Number.isFinite(item[field]) || item[field] < 0)) { errors.push(`${label}缺少可计算的批次字段`); continue; }
        const expected = selected.reduce((sum, i) => sum + i[field], 0);
        const value = Number(match[1]) * (/^(?:吨|tonnes?|t)$/i.test(match[2]) ? 1000 : 1);
        if (Math.abs(value - expected) > 1e-6) errors.push(`${label}数量与输入不符：${scope.length ? scope.map(i=>i.batchId).join('、') : '企业合计'}为 ${expected} kg 干胶；在库量、预留量、质检冻结量不能当作可用库存`);
      }
    }
  }
  }
  return [...new Set(errors)];
}
