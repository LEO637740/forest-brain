import {PriceFactorMonitor} from './PriceFactorMonitor';
import './economicFactors.css';

export type EconomicScenarioId = 'baseline'|'typhoon'|'demand_weak'|'policy_supply'|'robot_recovery';
type MachineryRow = {coveredTrees:number;productionKg:number;revenueCny:number;operatingCostCny:number;annualNetContributionCny:number};
export type EconomicImpact = {
  scenarioId:EconomicScenarioId;label:string;mode:'simulation';summary:string;
  drivers:{factor:string;horizon:'short'|'long';assumption:string;impact:string;action:string}[];
  changes:{key:string;label:string;unit:string;before:number;after:number;delta:number}[];
  machinery:{title:string;assumptions:Record<string,number>;manual:MachineryRow;robot:MachineryRow;
    incrementalProductionKg:number;incrementalAnnualContributionCny:number;paybackYears:number|null;basis:string;nextStep:string};
  basis:string;
};
export const economicOptions:{id:EconomicScenarioId;label:string}[] = [
  {id:'baseline',label:'当前经营条件'},
  {id:'typhoon',label:'台风影响生产运输'},
  {id:'demand_weak',label:'下游需求转弱'},
  {id:'policy_supply',label:'政策释放市场供给'},
  {id:'robot_recovery',label:'机器人降低作业成本'},
];
const number = (value:number) => value.toLocaleString('zh-CN',{maximumFractionDigits:2});

export function EconomicFactors({value,onChange,onCalculate,busy,impact,siteId}:{value:EconomicScenarioId;onChange:(value:EconomicScenarioId)=>void;onCalculate:()=>void;busy:boolean;impact?:EconomicImpact;siteId?:string}) {
  const selectedChanged = impact && value !== impact.scenarioId;
  return <>{siteId&&<PriceFactorMonitor siteId={siteId} scenarioId={value} onUseScenario={onChange}/>}
  <details className="hb-economy" aria-label="价格因素与经营情景" open={false}>
    <summary>经营情景 · {economicOptions.find(option=>option.id===value)?.label}<span className="hb-economy-tag">{value==='baseline'?'不叠加情景假设':'模拟情景'}</span></summary>
    <div className="hb-economy-select"><label>经营情景<select value={value} onChange={event=>onChange(event.target.value as EconomicScenarioId)}>{economicOptions.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label><button type="button" disabled={busy} onClick={onCalculate}>{busy?'正在测算…':'重新测算'}</button></div>
    {selectedChanged&&<p className="hb-economy-pending">情景已改变，重新测算后生效。</p>}
    {impact&&<><p className="hb-economy-summary"><strong>当前方案：{impact.label}</strong>{impact.summary}</p>
      <details className="hb-result-details"><summary>查看价格因素、计算变化与长期用工测算</summary>
        <p>{impact.basis}</p>
        <div className="hb-economy-drivers">{impact.drivers.map(driver=><article key={driver.factor}><h4>{driver.factor}<small>{driver.horizon==='long'?'长期因素':'短期因素'}</small></h4><p>{driver.impact}</p><p><strong>本次假设：</strong>{driver.assumption}</p><p><strong>下一步：</strong>{driver.action}</p></article>)}</div>
        <div className="hb-economy-table"><table><caption>从原始条件到本次情景</caption><thead><tr><th>项目</th><th>原始条件</th><th>情景计算后</th></tr></thead><tbody>{impact.changes.map(change=><tr key={change.key}><th>{change.label}</th><td>{number(change.before)} {change.unit}</td><td>{number(change.after)} {change.unit}</td></tr>)}</tbody></table></div>
        <h4>{impact.machinery.title}</h4><p>这是一片示例胶林的年度投入比较，新增产能单独测算。{impact.machinery.basis}</p>
        <div className="hb-economy-table"><table><thead><tr><th>方案</th><th>覆盖胶树</th><th>年产干胶</th><th>年作业与加工费用</th><th>扣除上述费用后的年收入</th></tr></thead><tbody>{[['人工',impact.machinery.manual],['机器人',impact.machinery.robot]].map(([label,row])=>{const result=row as MachineryRow;return <tr key={label as string}><th>{label as string}</th><td>{number(result.coveredTrees)} 棵</td><td>{number(result.productionKg)} 公斤</td><td>{number(result.operatingCostCny)} 元</td><td>{number(result.annualNetContributionCny)} 元</td></tr>;})}</tbody></table></div>
        <p>机器人相对人工每年多产 {number(impact.machinery.incrementalProductionKg)} 公斤干胶，扣除作业、加工和维护费用后多留 {number(impact.machinery.incrementalAnnualContributionCny)} 元；{impact.machinery.paybackYears===null?'按本次假设，新增收益尚不能收回机器投入。':`按本次假设约 ${number(impact.machinery.paybackYears)} 年收回机器投入。`}</p>
        <p><strong>下一步：</strong>{impact.machinery.nextStep}</p>
        <p className="hb-economy-assumptions">示例机器投入 {number(impact.machinery.assumptions.robotInvestmentCny)} 元；每年维护 {number(impact.machinery.assumptions.robotAnnualMaintenanceCny)} 元；每树每年割 {number(impact.machinery.assumptions.tappingsPerYear)} 次，每次 {number(impact.machinery.assumptions.dryKgPerTreeTapping)} 公斤干胶。</p>
        <nav className="hb-economy-documents"><a href="/materials/rubber-economic-study-20261021.pdf" target="_blank" rel="noreferrer">老师的橡胶经济研究材料 ↗</a><a href="/materials/rubber-business-plan-20261021.pdf" target="_blank" rel="noreferrer">查看业务落地说明 ↗</a><a href="/materials/rubber-landing-checklist-20261021.pdf" target="_blank" rel="noreferrer">价格因素与 EUDR 落到实处清单 ↗</a></nav>
      </details>
    </>}
  </details></>;
}

