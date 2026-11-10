import type {Task} from '../workspace/model';
import {treeAlias} from '../workspace/model';

export function DemoTaskAngleDetails({task}:{task:Task}) {
 const angles=task.demoStrategy?.adoptedAngles;
 if(!angles?.length)return null;
 return <details><summary>查看已采用的单树角度 · {angles.length} 棵</summary>
  <p>本任务保留创建时采用的单树参数；其他树使用分区角度。</p>
  <table><thead><tr><th>树木</th><th>执行角度</th><th>来源策略</th></tr></thead>
   <tbody>{angles.map(item=><tr key={item.treeIndex}><td>{treeAlias(item.treeIndex,task.site)}</td><td>{item.angleDeg}°</td><td>{item.strategyId} · v{item.revision}</td></tr>)}</tbody>
  </table>
 </details>;
}
