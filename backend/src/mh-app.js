import { createApp } from './server.js';

// Shared by the MH command and startup regression tests. The demo launcher
// enables automatic analysis by default; tests and callers can still opt into
// the explicit pause switches exposed by createApp.
export function createMhApp({enableAutomatic=false,automaticConfig,dataMode='mixed_demo',seedTasks=true,...options}={}) {
  return createApp({...options,
    seedTasks,
    automaticConfig:automaticConfig?{...automaticConfig,enabled:enableAutomatic}:null,
    automaticDataMode:dataMode,
    resumeModelsOnStart:enableAutomatic,
    resumeAutomaticOnStart:enableAutomatic});
}
