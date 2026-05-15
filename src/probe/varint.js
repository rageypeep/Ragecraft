function readVarInt(buffer, offset = 0) {
  let result = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    result |= (byte & 0x7f) << shift;
    cursor += 1;

    if ((byte & 0x80) === 0) {
      return {
        value: result,
        size: cursor - offset
      };
    }

    shift += 7;

    if (shift > 35) {
      throw new Error('VarInt is too large.');
    }
  }

  return null;
}

function writeVarInt(value) {
  let current = value >>> 0;
  const bytes = [];

  do {
    let temp = current & 0x7f;
    current >>>= 7;

    if (current !== 0) {
      temp |= 0x80;
    }

    bytes.push(temp);
  } while (current !== 0);

  return Buffer.from(bytes);
}

function readUnsignedShort(buffer, offset = 0) {
  if (buffer.length < offset + 2) {
    return null;
  }

  return {
    value: buffer.readUInt16BE(offset),
    size: 2
  };
}

function writeString(value) {
  const stringBuffer = Buffer.from(value, 'utf8');
  return Buffer.concat([writeVarInt(stringBuffer.length), stringBuffer]);
}

function readString(buffer, offset = 0) {
  const length = readVarInt(buffer, offset);

  if (!length) {
    return null;
  }

  const start = offset + length.size;
  const end = start + length.value;

  if (buffer.length < end) {
    return null;
  }

  return {
    value: buffer.toString('utf8', start, end),
    size: length.size + length.value
  };
}

module.exports = {
  readString,
  readUnsignedShort,
  readVarInt,
  writeString,
  writeVarInt
};
