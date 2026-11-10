// Deliberately bounded guards for known failure modes, not a natural-language truth oracle.
// The caller reports semantic interpretation and agronomic effectiveness as not_checked.
function parsed(record) { try { return JSON.parse(record.content); } catch { return null; } }
function blocks(candidate) {
  return [
    { text: candidate.summary, refs: candidate.evidenceRefs },
    ...candidate.reasons.map(r => ({ text: r.text, refs: r.sourceRefs })),
    ...candidate.proposal.findings.map(f => ({ text: `${f.assessment}。${f.limitation}`, refs: f.sourceRefs })),
    ...candidate.proposal.recommendations.map(r => ({ text: `${r.action}。${r.reason}`, refs: r.sourceRefs })),
    { text: candidate.proposal.uncertainty, refs: candidate.evidenceRefs },
  ];
}
function disclaimed(clause, position) {
  const before = clause.slice(Math.max(0, position - 24), position);
  const after = clause.slice(position, position + 30);
  // A negation before “而是/但是” does not negate the positive statement after it.
  const negativePrefix = before.split(/而是|但是|不过|然而|仍然|实际(?:上)?|就是/).at(-1);
  return /(?:不能|不可|不得|无法|并非|并不|不是|不应|尚不能|不代表|未能|避免|不宜据此|严禁|禁止)[^，,。；;]{0,20}$/.test(negativePrefix) ||
    /^(?:主力合约|适合作业|适宜作业).{0,6}(?:尚未确认|待确认|未获证实)/.test(after);
}

export function industryClaimErrors(candidate, records, now) {
  const errors = [], byId = new Map(records.map(r => [r.observationId, { ...r, data: parsed(r) }]));
  const date = new Date(+now + 8 * 3600000), year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
  const weatherData = [...byId.values()].filter(r => r.topic === 'weather');
  const unconfirmedLocation = weatherData.some(r => r.data?.referenceOnly || r.data?.location?.confirmed === false);
  for (const block of blocks(candidate)) {
    const sources = block.refs.map(ref => byId.get(ref)).filter(Boolean);
    const referenceWeather = sources.some(r => r.topic === 'weather' &&
      (r.data?.referenceOnly === true || r.data?.location?.confirmed === false || /参考点|地点待确认/.test(r.scope)));
    for (const sentence of block.text.normalize('NFKC').split(/[。；;\n]/)) {
      const clockRange = /\b\d{1,2}:\d{2}\s*[-—至]\s*\d{1,2}:\d{2}\s*(?:UTC\s*\+\s*8|北京时间)/i.exec(sentence);
      if (sources.some(r=>r.topic==='weather') && clockRange && !disclaimed(sentence, clockRange.index)) {
        errors.push('天气小时区间必须复制来源中包含日期和时区的完整ISO时间，不能自行给不完整的钟点范围贴UTC+8或北京时间标签');
      }
      const dryForecast = /(?:未来\s*24\s*小时|预报|参考点)[^。；;]{0,30}(?:无雨|无降雨|降雨量为0)/.exec(sentence);
      // Models often state the unsafe phrase and immediately negate it, e.g.
      // “逐小时有非零降雨，不能概括为无雨”.  The old check only looked
      // before the match and treated that valid disclaimer as a positive claim.
      const dryForecastDisclaimer = dryForecast && /(?:不能|不可|不得|无法|并非|并不|不是|不应|不代表|不宜)[^。；;]{0,36}(?:概括为|说|写成|当作|视为)?[^。；;]{0,16}(?:无雨|无降雨|降雨量为0)/.test(sentence);
      if (weatherData.some(r => !r.data?.forecast?.length || r.data.forecast.some(s => !Number.isFinite(s.rainfallMm) || s.rainfallMm > 0)) && dryForecast && !disclaimed(sentence, dryForecast.index) && !dryForecastDisclaimer) {
        errors.push('天气预报包含非零降雨或缺失雨量，不能概括为未来24小时无雨；空值不是零，少量降雨也不是无雨');
      }
      const soilClaim = /土壤水分[^。；;]{0,6}(?:充足|不足|适宜)/.exec(sentence);
      if (soilClaim && !disclaimed(sentence, soilClaim.index)) {
        errors.push('土壤含水量没有配套的土壤类型和农艺阈值，不能判定充足、不足或适宜；只陈述模型参考值');
      }
      const localClimate = /(?:当前|目前|近期)[^。；;]{0,16}(?:高温高湿|高温多雨|气候条件易)/.exec(sentence);
      if (unconfirmedLocation && localClimate && !disclaimed(sentence, localClimate.index)) {
        errors.push('园区地点未确认，旧病虫害指导也不是当前气候观测；不能声称园区目前处于该气候条件，应写明公告发布日期及适用条件');
      }
      // A bounded check for reusing a past month's outlook as a current forecast.
      const datedOutlooks = /(?:(\d{4})年)?(1[0-2]|0?[1-9])月[^。；;]{0,8}(?:预计|预期|预测|有望)|(?:预计|预期|预测|有望)[^\d。；;]{0,6}(?:(\d{4})年)?(1[0-2]|0?[1-9])月/g;
      for (const claim of sentence.matchAll(datedOutlooks)) {
        const claimYear = Number(claim[1] ?? claim[3] ?? year), claimMonth = Number(claim[2] ?? claim[4]);
        if (claimYear * 12 + claimMonth < year * 12 + month &&
            !disclaimed(sentence, claim.index) &&
            !(/当时|历史|原文/.test(sentence) && /已过期|不代表当前|不能用于当前/.test(sentence))) {
          errors.push('过去月份的报告展望不能作为当前预测；请省略，或明确说明报告当时的预测已过期、不代表当前趋势');
        }
      }
      const contractRange = /(?:近月|远月|各合约|多个合约)[^。；;]{0,40}(?:价|价格)[^。；;]{0,40}区间/.exec(sentence);
      if (sources.some(r => r.topic === 'market') && contractRange && !disclaimed(sentence, contractRange.index)) {
        errors.push('合约集合未定义，不能概括近月/远月/各合约价格区间；请逐一写明合约编号、交易日和价格口径');
      }
      // Daily contract quotes do not define the exchange's main-contract methodology.
      for (const match of sentence.matchAll(/主力合约/g)) if (!disclaimed(sentence, match.index)) {
        errors.push('本次契约没有主力合约判定依据；请写明具体合约及行情口径，不能称为“主力合约”');
      }
      if (referenceWeather) {
        const operation = /(?:适合|适宜|不适合|不宜|可以|能够|应当|必须)[^，,。；;]{0,12}(?:割胶|开割|作业)|(?:提前|调整|安排|暂停|停止|推迟)[^，,。；;]{0,12}(?:割胶|开割|作业)|(?:割胶|开割|作业)[^，,。；;]{0,8}(?:适宜|适合|暂停|停工)/g;
        for (const match of sentence.matchAll(operation)) {
          const local = sentence.slice(Math.max(0, match.index - 40), match.index + match[0].length);
          const explicitRainCondition=/降雨概率\s*(?:>=|≥)\s*60%或现场有雨均$/.test(sentence.slice(0,match.index));
          if (!explicitRainCondition && !disclaimed(sentence, match.index) && !/(?:核实|确认|补采|取得)[^，,。；;]{0,24}(?:后|再)|待[^，,。；;]{0,20}(?:确认|核实)|是否[^，,。；;]{0,12}$/.test(local.slice(0, -match[0].length))) {
            errors.push(`参考地点尚未确认为园区，不能据此给出割胶适宜性、停割或作业排班结论；只提示核实园区位置和现场观测后评估。需修改的表述：${match[0]}`);
          }
        }
      }
      // Check explicit contract + close/settlement + price statements, including thousands separators.
      const quotes = /\b(RU\d{4})\b[^，,。；;\n]{0,20}?(收盘|结算)(?:价格|价)?\s*(?:为|约|是|[:：=])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(元\s*[\/／]\s*吨|元\s*[\/／]\s*(?:千克|公斤|kg))/gi;
      for (const claim of sentence.matchAll(quotes)) {
        const field = claim[2] === '收盘' ? 'closeCnyPerTonne' : 'settlementCnyPerTonne';
        const expected = sources.flatMap(r => r.topic === 'market' ? r.data?.contracts ?? [] : [])
          .filter(r => r.contract === claim[1].toUpperCase()).map(r => r[field]).filter(Number.isFinite);
        const value = Number(claim[3].replaceAll(',', '')) * (/吨/.test(claim[4]) ? 1 : 1000);
        if (!expected.length || !expected.every(price => Math.abs(price - value) < 1e-6)) {
          errors.push(`${claim[1]}${claim[2]}价与该段引用的行情记录不符；不得混淆收盘/结算或元/吨与元/千克`);
        }
      }
    }
  }
  return [...new Set(errors)];
}
