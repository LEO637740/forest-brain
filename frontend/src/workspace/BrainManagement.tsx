import {useState} from 'react';
import {BrainLearning} from '../integration/BrainLearning';
import {ModelControlPanel} from '../integration/ModelControlPanel';
import {sites,type Site} from './model';
import '../integration/strategy-workspace.css';
import './restructure/strategy.css';

export function BrainManagement({site}:{site:Site}){
 const [tab,setTab]=useState<'learning'|'model'>('learning');
 return <div className="sc-page hb-workspace"><header className="sc-heading"><div><h1>大脑管理</h1><p>{sites[site]} · 管理经验、规则参数与模型调用</p></div></header>
  <nav className="sc-tabs" aria-label="大脑管理内容"><button className={tab==='learning'?'active':''} aria-pressed={tab==='learning'} onClick={()=>setTab('learning')}>经验与参数</button><button className={tab==='model'?'active':''} aria-pressed={tab==='model'} onClick={()=>setTab('model')}>模型设置</button></nav>
  {tab==='learning'?<BrainLearning site={site}/>:<ModelControlPanel/>}
 </div>;
}
