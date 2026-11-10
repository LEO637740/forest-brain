import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {provincesForView,provincePath,regionalProjection} from '../src/workspace/restructure/operatingRegions.ts';

const {features}=JSON.parse(readFileSync(new URL('../public/assets/geo/china-provinces.json',import.meta.url),'utf8'));

test('the production viewport includes the three requested provinces while center view retains the trial station',()=>{
  assert.deepEqual(provincesForView(features,'production').map(f=>f.properties.name).sort(),['云南省','广东省','海南省']);
  assert.deepEqual(provincesForView(features,'centers').map(f=>f.properties.name).sort(),['云南省','广东省','浙江省','海南省','陕西省']);
  for(const view of ['production','centers'])for(const feature of provincesForView(features,view)){
    const path=provincePath(feature,regionalProjection(view));
    assert.ok(path.startsWith('M')&&path.endsWith('Z'));
    assert.doesNotMatch(path,/NaN|Infinity/);
  }
});

test('all selectable stations fit their regional viewport with north above south',()=>{
  for(const view of ['production','centers']){
    const project=regionalProjection(view);
    const stations=[[110.3,19.8],[100.8,22],[113.3,22.8],...(view==='centers'?[[108.9,34.3],[120.15,30.28]]:[])];
    for(const station of stations){const [x,y]=project(station);assert.ok(x>30&&x<600&&y>30&&y<420);}
    assert.ok(project([110,25])[1]<project([110,20])[1]);
    assert.ok(project([115,20])[0]>project([110,20])[0]);
  }
});
