import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoContext } from '../src/adapters/context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { projectContext, checkCandidate } from '../src/validation.js';
import { tappingClaimErrors } from '../src/tapping-claims.js';

const now = new Date('2026-10-07T08:00:00Z');
async function fixture(humidity = 72) {
  const context = structuredClone(projectContext(makeDemoContext({now, treeIds: ['T-0001']}), 'tapping_angle'));
  context.modules.weather.observed.relativeHumidityPct = humidity;
  context.modules.tapping.panels[0].plannedCutSlopeDeg = 27;
  const candidate = await new RuleGenerator().generate({kind: 'tapping_angle', context, now});
  return {context, candidate};
}
function rejected(candidate, context, pattern) {
  assert.match(tappingClaimErrors(candidate, context).join('\n'), pattern);
  assert.throws(() => checkCandidate('tapping_angle', candidate, context, now), error => error.code === 'CANDIDATE_REJECTED' && error.details.some(x => pattern.test(x)));
}
function setRecommended(candidate, value) {
  candidate.proposal.recommendedCutSlopeDeg = value;
  candidate.proposal.angleModel.recommendedCutSlopeDeg = value;
}

test('actual low-humidity model mistake is rejected without prescribing a rule angle', async () => {
  const {context, candidate} = await fixture();
  candidate.summary = '在高湿条件下建议割线坡角由27°减小至25°';
  candidate.reasons[1].text = '根据当前高湿环境减小坡角';
  setRecommended(candidate, 25);
  candidate.proposal.conditions.push('减少坡角降低水土流失，改善地面稳定和树木支撑');
  rejected(candidate, context, /未达到.*80%/);
  assert.match(tappingClaimErrors(candidate, context).join('\n'), /水土流失/);
  const safe = await fixture();
  safe.candidate.summary = '候选坡角需专业复核，农艺依据不足';
  safe.candidate.reasons[1].text = '以本次割面记录为基准独立比较候选，未证明农艺效果';
  safe.candidate.proposal.conditions = ['需农艺人员复核后采用'];
  assert.doesNotThrow(() => checkCandidate('tapping_angle', safe.candidate, safe.context, now));
});

test('humidity denials, explicit future conditions and copied source rules remain valid', async () => {
  const {context, candidate} = await fixture();
  candidate.summary = '当前湿度72%，未达高湿阈值';
  candidate.reasons[1].text = '不能把72%说成高湿；若高湿需重新评估；需核实是否达到高湿阈值';
  candidate.proposal.conditions.push('如果现场进入高湿环境需重评', '当前并非高湿', '高湿条件尚未确认', '本次湿度72%低于80%的高湿阈值', '高湿演示阈值为80%，本次未触发高湿调整');
  assert.deepEqual(tappingClaimErrors(candidate, context), []);
  assert.doesNotThrow(() => checkCandidate('tapping_angle', candidate, context, now));
  const high = await fixture(84);
  high.candidate.summary = '高湿演示条件下的候选，需专业确认';
  assert.deepEqual(tappingClaimErrors(high.candidate, high.context), []);
});

test('humidity denials phrased as execution guards remain valid', async () => {
  const {context, candidate} = await fixture();
  candidate.proposal.conditions.push(
    '本次条件不构成高湿，不以高湿作为调整依据',
    '当前不属于高湿条件，不触发高湿调整',
    '湿度未达80%，不得按高湿条件执行',
  );
  assert.deepEqual(tappingClaimErrors(candidate, context), []);
  assert.doesNotThrow(() => checkCandidate('tapping_angle', candidate, context, now));
});

test('ground effects and slope conflation cannot be justified by conditions or caveats', async () => {
  for (const text of ['减小割线坡角可降低水土流失', '建议25°以改善地面稳定和树木支撑', '如果减小割线坡角就能增强根系稳定', '割线角度就是地面坡度', '不能证明农艺效果，但可以降低水土流失']) {
    const {context, candidate} = await fixture();
    candidate.proposal.conditions.push(text);
    rejected(candidate, context, /树干割线坡角不是地面坡度/);
  }
  const {context, candidate} = await fixture();
  candidate.proposal.conditions.push('割线坡角不是地面坡度', '不能推断降低水土流失的效益', '不代表改善地面稳定或树木支撑', '没有地形资料，水土流失风险需独立评估');
  assert.deepEqual(tappingClaimErrors(candidate, context), []);
});

test('missing viscosity cannot become a measured fact or observed latex consistency', async () => {
  for (const text of ['根据实测黏度推荐25°', '胶乳黏度较高，建议增大角度', '现场观测到胶乳稀薄', '粘度为20mPa·s', '未提供黏度，但是已观测到黏度偏高', '没有黏度数据但黏度偏高']) {
    const {context, candidate} = await fixture();
    candidate.reasons[1].text = text;
    rejected(candidate, context, /未提供胶乳黏度观测/);
  }
  const {context, candidate} = await fixture();
  candidate.proposal.conditions.push('黏度数据未提供', '不能认为胶乳稀薄', '若后续测得黏度较高需重新分析', '需补测胶乳黏度', '胶乳黏度有待测量');
  assert.deepEqual(tappingClaimErrors(candidate, context), []);
});

test('normal rule candidates remain valid at low and high humidity', async () => {
  for (const humidity of [72, 79, 80, 84]) {
    const {context, candidate} = await fixture(humidity);
    assert.deepEqual(tappingClaimErrors(candidate, context), []);
    assert.doesNotThrow(() => checkCandidate('tapping_angle', candidate, context, now));
  }
});
