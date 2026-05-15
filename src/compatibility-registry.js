const fs = require('node:fs');
const path = require('node:path');

const TARGET_REGISTRIES = {
  'minecraft:cat_sound_variant': 'cat_sound_variant',
  'minecraft:cat_variant': 'cat_variant',
  'minecraft:chicken_sound_variant': 'chicken_sound_variant',
  'minecraft:chicken_variant': 'chicken_variant',
  'minecraft:cow_sound_variant': 'cow_sound_variant',
  'minecraft:cow_variant': 'cow_variant',
  'minecraft:dimension_type': 'dimension_type',
  'minecraft:enchantment': 'enchantment',
  'minecraft:pig_sound_variant': 'pig_sound_variant',
  'minecraft:pig_variant': 'pig_variant',
  'minecraft:timeline': 'timeline',
  'minecraft:world_clock': 'world_clock',
  'minecraft:wolf_sound_variant': 'wolf_sound_variant',
  'minecraft:wolf_variant': 'wolf_variant'
};

function loadCompatibilityRegistryOverrides(advertisedVersion) {
  const filePath = path.join(
    process.cwd(),
    'porting',
    advertisedVersion,
    'registry-overrides.json'
  );

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cloneRegistryCodec(codec) {
  return JSON.parse(JSON.stringify(codec));
}

function buildCompatibilityRegistryCodec(baseCodec, rawOverrides) {
  if (!rawOverrides?.registries) {
    return baseCodec;
  }

  const mergedCodec = cloneRegistryCodec(baseCodec);

  for (const [registryId, folderName] of Object.entries(TARGET_REGISTRIES)) {
    const overrideEntries = rawOverrides.registries[registryId];

    if (!overrideEntries) {
      continue;
    }

    mergedCodec[registryId] ??= {
      id: registryId,
      entries: []
    };

    const exemplarEntries = new Map(
      mergedCodec[registryId].entries.map((entry) => [entry.key, entry.value])
    );

    mergedCodec[registryId].entries = Object.entries(overrideEntries).map(([key, value]) => ({
      key,
      value: convertJsonToTypedNbt(value, exemplarEntries.get(key), `${folderName}/${key}`)
    }));
  }

  return mergedCodec;
}

function convertJsonToTypedNbt(value, exemplar, pathLabel) {
  if (Array.isArray(value)) {
    return convertArrayToTypedNbt(value, exemplar, pathLabel);
  }

  if (value && typeof value === 'object') {
    return convertObjectToTypedNbt(value, exemplar, pathLabel);
  }

  return convertPrimitiveToTypedNbt(value, exemplar, pathLabel);
}

function convertObjectToTypedNbt(value, exemplar, pathLabel) {
  const typedValue = {};
  const exemplarValue = getCompoundExemplarValue(exemplar);

  for (const [key, childValue] of Object.entries(value)) {
    const childExemplar = exemplarValue?.[key];
    typedValue[key] = convertJsonToTypedNbt(childValue, childExemplar, `${pathLabel}.${key}`);
  }

  return {
    type: 'compound',
    value: typedValue
  };
}

function convertArrayToTypedNbt(value, exemplar, pathLabel) {
  if (exemplar?.type === 'list') {
    const elementType = exemplar.value.type;
    const exemplarItems = exemplar.value.value;
    const itemExemplars = Array.isArray(exemplarItems)
      ? exemplarItems.map((item) => wrapListItemExemplar(elementType, item))
      : [];
    const fallbackExemplar = itemExemplars[0];

    return {
      type: 'list',
      value: {
        type: elementType,
        value: value.map((item, index) => convertListItem(
          item,
          elementType,
          itemExemplars[index] ?? fallbackExemplar,
          pathLabel
        ))
      }
    };
  }

  const firstItem = value[0];
  const inferredElementType = inferListElementType(firstItem);
  const itemExemplar = pickSyntheticExemplarForListType(inferredElementType);

  return {
    type: 'list',
    value: {
      type: inferredElementType,
      value: value.map((item) => convertListItem(item, inferredElementType, itemExemplar, pathLabel))
    }
  };
}

function convertListItem(item, elementType, exemplar, pathLabel) {
  if (elementType === 'compound') {
    return convertObjectToTypedNbt(item, exemplar, pathLabel).value;
  }

  if (elementType === 'list') {
    return convertArrayToTypedNbt(item, exemplar, pathLabel).value;
  }

  return coercePrimitiveValueToType(item, elementType, exemplar, pathLabel);
}

function convertPrimitiveToTypedNbt(value, exemplar, pathLabel) {
  const type = isPrimitiveNbtType(exemplar?.type)
    ? exemplar.type
    : inferPrimitiveType(value);

  return {
    type,
    value: coercePrimitiveValueToType(value, type, exemplar, pathLabel)
  };
}

function coercePrimitiveValueToType(value, type, exemplar, pathLabel) {
  if (type === 'byte' && typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (type === 'byte' && typeof value === 'number') {
    return Math.trunc(value);
  }

  if (type === 'int' || type === 'short') {
    return Math.trunc(value);
  }

  if (type === 'float' || type === 'double') {
    return globalThis.Number(value);
  }

  if (type === 'long') {
    return BigInt(value);
  }

  if (type === 'string') {
    return String(value);
  }

  if (!exemplar && type === 'byte' && typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (type === 'intArray') {
    return value.map((entry) => Math.trunc(entry));
  }

  if (type === 'longArray') {
    return value.map((entry) => BigInt(entry));
  }

  if (type === 'byteArray') {
    return value.map((entry) => Math.trunc(entry));
  }

  if (value === null || value === undefined) {
    throw new Error(`Cannot encode null or undefined primitive at ${pathLabel}`);
  }

  return value;
}

function inferListElementType(firstItem) {
  if (Array.isArray(firstItem)) {
    return 'list';
  }

  if (firstItem && typeof firstItem === 'object') {
    return 'compound';
  }

  return inferPrimitiveType(firstItem);
}

function inferPrimitiveType(value) {
  if (typeof value === 'boolean') {
    return 'byte';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'double';
  }

  if (typeof value === 'string') {
    return 'string';
  }

  throw new Error(`Unsupported primitive value type: ${typeof value}`);
}

function isPrimitiveNbtType(type) {
  return [
    'byte',
    'short',
    'int',
    'long',
    'float',
    'double',
    'string'
  ].includes(type);
}

function getCompoundExemplarValue(exemplar) {
  if (!exemplar || Array.isArray(exemplar) || typeof exemplar !== 'object') {
    return {};
  }

  if (exemplar.type === 'compound') {
    return exemplar.value;
  }

  if ('type' in exemplar && 'value' in exemplar) {
    return {};
  }

  return exemplar;
}

function wrapListItemExemplar(elementType, exemplarValue) {
  if (!exemplarValue) {
    return undefined;
  }

  if (exemplarValue.type === elementType) {
    return exemplarValue;
  }

  return {
    type: elementType,
    value: exemplarValue
  };
}

function pickSyntheticExemplarForListType(type) {
  if (type === 'compound') {
    return { type: 'compound', value: {} };
  }

  if (type === 'list') {
    return { type: 'list', value: { type: 'string', value: [] } };
  }

  return { type, value: null };
}

module.exports = {
  buildCompatibilityRegistryCodec,
  loadCompatibilityRegistryOverrides
};
