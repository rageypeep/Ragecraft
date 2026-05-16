const fs = require('fs');
const path = require('path');

function loadTargetBlocksReport(version) {
  const candidatePaths = [
    path.join(__dirname, '..', 'porting', version, 'generated-reports', 'reports', 'blocks.json'),
    path.join(__dirname, '..', 'porting', version, 'generated-reports-2', 'reports', 'blocks.json')
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    }
  }

  return null;
}

function createCompatibilityBlockStateTranslator(baseMcData, version) {
  const targetBlocksReport = loadTargetBlocksReport(version);

  if (!targetBlocksReport) {
    return {
      translate(stateId) {
        return stateId;
      }
    };
  }

  const mapping = new Map();

  for (const [blockName, baseBlock] of Object.entries(baseMcData.blocksByName)) {
    const targetBlock = targetBlocksReport[`minecraft:${blockName}`];

    if (!targetBlock) {
      continue;
    }

    const targetStates = targetBlock.states ?? [];
    const baseStateCount = (baseBlock.maxStateId - baseBlock.minStateId) + 1;

    if (targetStates.length !== baseStateCount) {
      continue;
    }

    for (let offset = 0; offset < baseStateCount; offset++) {
      const baseStateId = baseBlock.minStateId + offset;
      const targetStateId = targetStates[offset]?.id;

      if (Number.isInteger(targetStateId)) {
        mapping.set(baseStateId, targetStateId);
      }
    }
  }

  return {
    translate(stateId) {
      return mapping.get(stateId) ?? stateId;
    }
  };
}

module.exports = {
  createCompatibilityBlockStateTranslator
};
