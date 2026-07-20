'use strict';

// Used by hive/lib/session-client.js for managed-session cloud-mode detection.
function getExecutionSubstrate(config) {
  if (!config || !config.execution || typeof config.execution.substrate !== 'string') {
    return undefined;
  }
  return config.execution.substrate;
}

// Used by hive/lib/session-client.js to select the configured runtime mode.
function getCloudMode(config) {
  return getExecutionSubstrate(config) === 'sessions-cloud';
}

module.exports = { getCloudMode, getExecutionSubstrate };
