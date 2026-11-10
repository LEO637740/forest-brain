// Explicit model fixtures for offline tests. Suggestions are deliberately fixed:
// a test changes them itself instead of recreating the old economic rule score.
export function parkProposal(frequency=2) {
  return {summary:`测试模型建议各区每周 ${frequency} 次，由模型比较经营数据后提出。`,
    zones:['A','B','C','D'].map(zone=>({zone,frequencyPerWeek:frequency,
      reason:`${zone}区按测试模型选择安排 ${frequency} 次；执行前再核验天气和仓容。`,inputKeys:['selling_price','cost','demand','stock']})),
    drivers:[{inputKey:'selling_price',interpretation:'区域现货价仅用于参考收入，期货变化不等于实际成交。',effect:'hold'},
      {inputKey:'cost',interpretation:'成本与干胶单产一并评估贡献。',effect:'hold'},
      {inputKey:'demand',interpretation:'需求依照本次证据的实际、假设或模拟口径。',effect:'hold'},
      {inputKey:'stock',interpretation:'库存和冻结量影响经营选择，仓容由执行层核验。',effect:'hold'}],
    risks:['这是测试模型返回值，不是实际经营预测。']};
}

export function planModel(frequency=2) {
  return {isConfigured:()=>true,describe:()=>({configured:true,provider:'test',model:'park-plan-fixture'}),
    async complete(){return {content:JSON.stringify(parkProposal(frequency)),toolCalls:[],usage:{promptTokens:100,completionTokens:50}};}};
}

export function modelProposal(frequency=2) {
  return {mode:'llm',provider:'test',model:'park-plan-fixture',generatedAt:'2026-10-27T00:00:00.000Z',
    inputSnapshot:{testFixture:true},inputFingerprint:'explicit-test-model-input',durationMs:0,...parkProposal(frequency)};
}
