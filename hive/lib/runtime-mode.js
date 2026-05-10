'use strict';

function getExecutionSubstrate(config) {
  if (!config || !config.execution || typeof config.execution.substrate !== 'string') {
    return undefined;
  }
  return config.execution.substrate;
}

function getCloudMode(config) {
  return getExecutionSubstrate(config) === 'sessions-cloud';
}

module.exports = { getCloudMode, getExecutionSubstrate };
