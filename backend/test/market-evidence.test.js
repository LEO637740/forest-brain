import test from 'node:test';
import assert from 'node:assert/strict';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {checkCandidate} from '../src/validation.js';

test('market explanation includes the price series and weather that drive its frequency decision',async()=>{
 const now=new Date('2026-10-19T00:00:00Z');
 const context=makeParkContext({treeIds:['T-0001','T-0012'],now});
 context.modules.market.demand.value=125;
 context.modules.weather.observed.rainfallMm=4;
 const candidate=await new RuleGenerator().generate({kind:'market_scenario',context,now});
 assert.doesNotThrow(()=>checkCandidate('market_scenario',candidate,context,now));
 const reason=candidate.reasons[1];
 for(const price of context.modules.market.prices)assert.ok(reason.sourceRefs.includes(price.observationId));
 assert.ok(reason.sourceRefs.includes(context.modules.weather.observed.observationId));
 assert.match(reason.text,/需求指数 125|现场有降雨|1 棵符合/);
 assert.equal(candidate.proposal.targetFrequencyPerWeek,1);
});
