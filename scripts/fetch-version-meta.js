const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Request failed: ${response.statusCode} ${response.statusMessage}`));
        response.resume();
        return;
      }

      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const requestedVersion = process.argv[2];

  if (!requestedVersion) {
    throw new Error('Usage: node scripts/fetch-version-meta.js <minecraft-version>');
  }

  const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  const versionEntry = manifest.versions.find((entry) => entry.id === requestedVersion);

  if (!versionEntry) {
    throw new Error(`Version ${requestedVersion} was not found in Mojang's version manifest.`);
  }

  const detail = await fetchJson(versionEntry.url);
  const outputDirectory = path.join(process.cwd(), 'porting', requestedVersion);

  await fs.mkdir(outputDirectory, { recursive: true });

  const output = {
    fetchedAt: new Date().toISOString(),
    latest: manifest.latest,
    version: versionEntry,
    detail: {
      id: detail.id,
      type: detail.type,
      javaVersion: detail.javaVersion,
      assetIndex: detail.assetIndex,
      downloads: detail.downloads,
      logging: detail.logging
    }
  };

  const outputPath = path.join(outputDirectory, 'version-meta.json');
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
