const minecraftData = require('minecraft-data');

const CUSTOM_VERSION_COMPATIBILITY = {
  '26.1': {
    advertisedVersion: '26.1',
    protocolVersion: 775,
    baseVersion: '1.21.11',
    status: 'experimental'
  },
  '26.1.1': {
    advertisedVersion: '26.1.1',
    protocolVersion: 775,
    baseVersion: '1.21.11',
    status: 'experimental'
  },
  '26.1.2': {
    advertisedVersion: '26.1.2',
    protocolVersion: 775,
    baseVersion: '1.21.11',
    status: 'experimental'
  }
};

function resolveVersionTarget(requestedVersion) {
  const directData = minecraftData(requestedVersion);

  if (directData) {
    return {
      requestedVersion,
      protocolDataVersion: requestedVersion,
      advertisedVersion: directData.version.minecraftVersion,
      protocolVersion: directData.version.version,
      compatibility: null,
      createServerOptions: {
        version: requestedVersion
      }
    };
  }

  const compatibility = CUSTOM_VERSION_COMPATIBILITY[requestedVersion];

  if (!compatibility) {
    throw new Error(`Unsupported Minecraft version "${requestedVersion}". No direct protocol data or local compatibility mapping exists.`);
  }

  return {
    requestedVersion,
    protocolDataVersion: compatibility.baseVersion,
    advertisedVersion: compatibility.advertisedVersion,
    protocolVersion: compatibility.protocolVersion,
    compatibility,
    createServerOptions: {
      version: false,
      fallbackVersion: compatibility.baseVersion,
      beforePing(response) {
        return {
          ...response,
          version: {
            name: compatibility.advertisedVersion,
            protocol: compatibility.protocolVersion
          }
        };
      }
    }
  };
}

module.exports = {
  CUSTOM_VERSION_COMPATIBILITY,
  resolveVersionTarget
};
