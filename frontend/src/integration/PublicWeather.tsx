import {ParkWeather} from './ParkWeather';
import type {EnvironmentSite} from './client';
export function PublicWeather({site='hainan'}:{site?:EnvironmentSite}){return <ParkWeather key={site} site={site} dataOnly/>;}
