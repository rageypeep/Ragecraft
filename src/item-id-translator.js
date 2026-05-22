const fs = require('fs');
const path = require('path');

function loadTargetRegistriesReport(version) {
  const candidatePaths = [
    path.join(__dirname, '..', 'porting', version, 'generated-reports', 'reports', 'registries.json'),
    path.join(__dirname, '..', 'porting', version, 'generated-reports-2', 'reports', 'registries.json')
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    }
  }

  return null;
}

function createCompatibilityItemIdTranslator(baseMcData, version) {
  const targetRegistriesReport = loadTargetRegistriesReport(version);
  const targetItems = targetRegistriesReport?.['minecraft:item']?.entries;

  if (!targetItems) {
    return {
      translate(itemId) {
        return itemId;
      }
    };
  }

  const mapping = new Map();

  for (const [itemName, baseItem] of Object.entries(baseMcData.itemsByName)) {
    const targetItem = targetItems[`minecraft:${itemName}`];

    if (Number.isInteger(baseItem?.id) && Number.isInteger(targetItem?.protocol_id)) {
      mapping.set(baseItem.id, targetItem.protocol_id);
    }
  }

  return {
    translate(itemId) {
      return mapping.get(itemId) ?? itemId;
    }
  };
}

module.exports = {
  createCompatibilityItemIdTranslator
};
