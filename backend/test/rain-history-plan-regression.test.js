import test from 'node:test';
import assert from 'node:assert/strict';
import {modelProposal} from './helpers/park-plan-model.js';
import {ParkWeatherWindows} from '../src/park-weather.js';
import {calculateParkPlan} from '../src/park-plan.js';
import {makeParkContext} from '../src/adapters/park-demo.js';

const NOW = new Date('2026-10-25T21:30:00Z'); // 10/26 05:30 Beijing
const SITE = 'demo-hainan';
const RAINY_DAY = '2026-10-29';
const beijingDay = milliseconds => new Date(milliseconds + 8 * 3600000).toISOString().slice(0, 10);

// Exercise the public-weather adapter and shared policy together, not a hand-
// labelled "suitable" window. Hourly rain is the amount ending at its timestamp.
function rawWeather() {
  const hour = Math.floor(+NOW / 3600000) * 3600;
  const time = Array.from({length:360}, (_, index) => hour - 168 * 3600 + index * 3600);
  const historyAt = hour - 24 * 3600;
  const rainy = at => beijingDay((at - 3600) * 1000) === RAINY_DAY;
  return {
    latitude:19.8, longitude:110.3,
    hourly_units:{time:'unixtime', temperature_2m:'°C', relative_humidity_2m:'%', precipitation_probability:'%', rain:'mm', showers:'mm', soil_moisture_0_to_1cm:'m³/m³'},
    hourly:{time,
      temperature_2m:time.map(() => 25),
      relative_humidity_2m:time.map(() => 80),
      precipitation_probability:time.map(at => rainy(at) ? 90 : 20),
      rain:time.map(at => at === historyAt ? 10.3 : rainy(at) ? 8 : 0),
      showers:time.map(() => 0),
      soil_moisture_0_to_1cm:time.map(() => 0.383)},
    current_units:{time:'unixtime', temperature_2m:'°C', relative_humidity_2m:'%', precipitation:'mm'},
    current:{time:+NOW / 1000, interval:900, temperature_2m:25, relative_humidity_2m:80, precipitation:0},
  };
}

async function forecast(raw) {
  const service = new ParkWeatherWindows({service:{get:async () => raw},clock:() => NOW});
  return {service, weather:await service.read(SITE)};
}

function planFor(weather) {
  const context = makeParkContext({siteId:SITE, now:NOW});
  context.modules.market.demand.value = 120;
  return calculateParkPlan({modelProposal:modelProposal(3),siteId:SITE, now:NOW, context, inventory:{stockKg:300,availableKg:300},
    storageKg:900, plannedSalesKg:0, events:[], salesSource:'test', liveWeather:weather});
}

test('past 10.3mm rain does not cancel a week with dry working windows; the actual rainy day remains excluded', async () => {
  const {weather} = await forecast(rawWeather());
  assert.equal(weather.windows[0].recentRainfallTotalMm, 10.3);
  assert.equal(weather.windows[0].soilMoisturePct, 38.3);
  assert.equal(weather.windows[0].suitability, 'suitable');
  const rainyWindows = weather.windows.filter(window => beijingDay(Date.parse(window.start)) === RAINY_DAY);
  assert.equal(rainyWindows.length, 24);
  assert.ok(rainyWindows.every(window => window.suitability === 'defer'));
  const followingDry = weather.windows.find(window => window.start === '2026-10-29T22:00:00.000Z'); // 10/30 06:00
  assert.equal(followingDry.rainfallMm, 0);
  assert.equal(followingDry.suitability, 'suitable', 'prior rain alone must not block the next dry workday');

  const plan = planFor(weather);
  assert.notEqual(plan.stance, 'pause');
  assert.ok(plan.production.expectedDryKg > 0);
  assert.ok(plan.zones.some(zone => zone.schedule.length > 0));
  assert.equal(plan.outlook.find(day => day.date === RAINY_DAY).tappable, false);
  for (const zone of plan.zones) for (const slot of zone.schedule) {
    assert.notEqual(slot.date, RAINY_DAY);
    const from = Date.parse(`${slot.date}T${slot.start}:00+08:00`);
    const to = Date.parse(`${slot.date}T${slot.end}:00+08:00`);
    const covered = weather.windows.filter(window => Date.parse(window.end) > from && Date.parse(window.start) < to);
    assert.ok(covered.length > 0);
    assert.ok(covered.every(window => window.suitability === 'suitable'));
  }
});

test('dry current conditions allow execution despite rain history, but current 8mm rain still stops it', async () => {
  const raw = rawWeather();
  const {service, weather} = await forecast(raw);
  assert.equal(weather.execution.currentRainfallMm, 0);
  assert.equal(weather.execution.allowed, true);
  raw.current.precipitation = 8;
  const heavy = await service.read(SITE, {force:true});
  assert.equal(heavy.execution.currentRainfallMm, 8);
  assert.equal(heavy.execution.allowed, false);
  assert.equal(heavy.execution.suitability, 'defer');
  assert.ok(heavy.windows.some(window => window.suitability === 'suitable'), 'current rain must not veto every future dry hour');
});

test('relaxing historical rainfall does not ignore explicit current wet soil or current high rain probability', async () => {
  const raw = rawWeather();
  const currentIndex = raw.hourly.time.findLastIndex(at => at * 1000 <= +NOW);
  raw.hourly.soil_moisture_0_to_1cm[currentIndex] = 0.8;
  const {service, weather} = await forecast(raw);
  assert.equal(weather.windows[0].soilMoisturePct, 80);
  assert.equal(weather.execution.suitability, 'review');
  assert.equal(weather.execution.allowed, false);
  raw.hourly.soil_moisture_0_to_1cm[currentIndex] = 0.383;
  raw.hourly.precipitation_probability[currentIndex + 1] = 90;
  const risk = await service.read(SITE, {force:true});
  assert.equal(risk.execution.suitability, 'defer');
  assert.equal(risk.execution.allowed, false);
});
