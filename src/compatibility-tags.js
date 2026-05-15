const fs = require('node:fs');
const path = require('node:path');

function loadCompatibilityTags(advertisedVersion) {
  const filePath = path.join(
    process.cwd(),
    'porting',
    advertisedVersion,
    'configuration-tags.json'
  );

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  return Array.isArray(parsed.tags) ? parsed.tags : [];
}

module.exports = {
  loadCompatibilityTags
};
