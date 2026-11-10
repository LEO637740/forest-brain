// Bounded checks for observed model mistakes, not a general agronomic truth oracle.
// Candidate angles may differ from the rule baseline; their stated facts must not.
const humidityTerms = /高湿(?:度)?|湿度(?:偏高|较高|过高)|较高(?:的)?湿度/g;
const viscosityTerms = /(?:黏|粘)度|(?:胶乳|乳胶)(?:已|比较|较|很|过于|呈|是|为)?(?:稀薄|黏稠|粘稠)/g;
const groundTerms = /水土流失|土壤侵蚀|(?:地面|地表|土地|土壤|边坡)(?:的)?稳定(?:性)?|(?:树木|树体)(?:的)?支撑|根系(?:的)?(?:稳固|稳定)|(?:地面|地形|地表|山坡)(?:的)?坡度/g;
const effect = /降低|减少|减轻|改善|提高|增强|增加|防止|避免|缓解|保障|保证|维持|有利于|有助于|促进/;

function clauses(text) {
  // A disclaimer before “但/而是” must not exempt a later affirmative claim.
  return String(text ?? '').normalize('NFKC').split(/[。；;，,\n]|但是|但(?!凡)|然而|不过|而是/).map(x => x.trim()).filter(Boolean);
}
function negative(clause, match) {
  const before = clause.slice(Math.max(0, match.index - 36), match.index);
  const after = clause.slice(match.index + match[0].length, match.index + match[0].length + 22);
  return /(?:不能|不可|不得|不得按|无法|并非|并不|不是|不应|不代表|不等于|不构成|不触发|不以[^。；;，,]{0,18}(?:为|作|作为)|不作为|未达(?:到)?|尚未达(?:到)?|未触发|未处于|不属于|未认定|未证实|未验证|没有|缺少|缺乏|未提供|尚未提供|未采集|未测量|未实测)[^。；;，,]{0,26}$/.test(before)
    || /不以[^。；;，,]{0,18}$/.test(before) && /^(?:[^。；;，,]{0,18})(?:为|作|作为)/.test(after)
    || /^(?:\s|数值|数据|观测|测量|效益|效果|作用|阈值|条件|影响|的效果|的作用|的效益){0,5}(?:未提供|未测量|未采集|缺失|未知|尚未确认|未获证实|无法确认|不能确定|未经验证|未经证实|未验证|未证实|无关|不是|不代表|不等于)/.test(after);
}
function conditional(clause, match) {
  const before = clause.slice(Math.max(0, match.index - 36), match.index);
  const after = clause.slice(match.index + match[0].length, match.index + match[0].length + 28);
  return /(?:若|如果|假如|假设|一旦|当)[^。；;，,]{0,26}$/.test(before)
    || /(?:是否|需核实|需核验|须核实|须核验|待核实|待核验|需补测|须补测|待补测|需测量|待测量)[^。；;，,]{0,20}$/.test(before)
    || /^(?:\s|数值|数据|观测){0,4}(?:需(?:要)?补测|有待测量|有待采集|需核实|需核验|待确认)/.test(after);
}
function texts(candidate) {
  return [candidate.summary, ...(candidate.reasons ?? []).map(r => r.text), ...(candidate.proposal?.conditions ?? [])];
}
function humidityDefinition(clause, match) {
  const before = clause.slice(0, match.index);
  const after = clause.slice(match.index + match[0].length);
  return /(?:低于|不到|未满|不及)\s*80\s*%\s*(?:的|演示|示例){0,2}$/.test(before)
    || /^(?:演示|示例)?阈值(?:为|是|定为|设为|定义为)?\s*80\s*%/.test(after);
}

export function tappingClaimErrors(candidate, context) {
  const errors = [], m = context.modules;
  const humidity = m.weather?.observed?.relativeHumidityPct;
  const panel = m.tapping?.panels?.find(p => p.treeId === candidate.proposal?.treeId) ?? m.tapping?.panels?.[0];
  const simulatedViscosity = panel?.latexViscosity?.provenance?.mode === 'simulated';
  const rules = (m.knowledge?.rules ?? []).filter(r => r.kind === 'tapping_angle');
  // 80% is this delivered demonstration's threshold, not a claimed agronomic standard.
  const demoHumidityRule = rules.some(r => r.version === 'demo-rules-2' && /高湿/.test(r.text));
  const ruleTexts = new Set(rules.map(r => r.text));
  for (const text of texts(candidate)) {
    const quotedRule = ruleTexts.has(text);
    for (const clause of clauses(text)) {
      if (demoHumidityRule && Number.isFinite(humidity) && humidity < 80 && !quotedRule) {
        for (const match of clause.matchAll(humidityTerms)) if (!negative(clause, match) && !conditional(clause, match) && !humidityDefinition(clause, match)) {
          errors.push(`现场相对湿度为 ${humidity}%，未达到本演示规则的 80% 高湿阈值；不能把本次条件说成高湿，规则仅可作为条件说明`);
        }
      }
      for (const match of clause.matchAll(groundTerms)) {
        const local = clause.slice(Math.max(0, match.index - 40), match.index + match[0].length + 30);
        const conflatesSlope = /(?:地面|地形|地表|山坡)(?:的)?坡度/.test(match[0]) && /割线|割胶|坡角|角度/.test(local) && /等同|相当|就是|代表|即|对应|控制|(?:角度|坡角)(?:为|是)/.test(local);
        if ((effect.test(local) || conflatesSlope) && !negative(clause, match) && !/(?:是否|需独立评估|应独立评估)[^。；;，,]{0,24}$/.test(clause.slice(0, match.index))) {
          errors.push('树干割线坡角不是地面坡度；不得声称调整割线坡角能降低水土流失、改善地面稳定或增强树木支撑');
        }
      }
      // A real assay may be supplied later; until then, reject unlabelled
      // viscosity claims and accept only the explicitly simulated fixture.
      for (const match of clause.matchAll(viscosityTerms)) {
        if (negative(clause, match) || conditional(clause, match)) continue;
        const before = clause.slice(Math.max(0, match.index - 28), match.index);
        const after = clause.slice(match.index + match[0].length, match.index + match[0].length + 28);
        const measured = /实测|测得|检测到|观测到|(?:根据|基于|依据)[^。；;，,]{0,16}$/.test(before);
        const assertedValue = /^(?:\s|实测值|测量值|水平|数值|值|当前|现为|目前){0,4}(?:偏高|较高|过高|高|偏低|较低|低|为|是|达到|约|升高|降低|增加|减少|\d)/.test(after);
        // Demo fixtures may carry a clearly labelled simulated assay.  They
        // can be shown as context, but cannot be presented as field-measured
        // agronomy or used to claim that an angle is optimal.
        const labelledSimulation = simulatedViscosity && /模拟|simulated|演示字段|非实测/.test(clause);
        if (labelledSimulation) continue;
        if (measured || assertedValue || /(?:稀薄|黏稠|粘稠)/.test(match[0])) {
          errors.push('本次输入未提供胶乳黏度观测；不得编造实测黏度、黏度高低或胶乳已稀薄/黏稠的事实，应保留缺项并建议补测');
        }
      }
    }
  }
  return [...new Set(errors)];
}
