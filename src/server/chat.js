const nbt = require('prismarine-nbt');

const SERVER_UUID = 'd3527a0b-bc03-45d5-a878-2aafdd8c8a43';

function buildChatComponent(mcData, text) {
  return mcData.supportFeature('chatPacketsUseNbtComponents')
    ? nbt.comp({ text: nbt.string(text) })
    : JSON.stringify({ text });
}

function formatWelcomeMessage(template, username) {
  return template.replaceAll('{username}', username);
}

function extractChatMessage(packet) {
  if (!packet || typeof packet !== 'object') {
    return '';
  }

  if (typeof packet.message === 'string') {
    return packet.message;
  }

  if (typeof packet.plainMessage === 'string') {
    return packet.plainMessage;
  }

  return '';
}

function createChatApi({ connectedClients, isCompatibilityActive, mcData, server }) {
  let nextChatIndex = 1;

  function sendMessage(clients, text, sender = 'Server', kind = 'system') {
    if (!clients.length || isCompatibilityActive()) {
      return;
    }

    if (mcData.supportFeature('signedChat')) {
      server.writeToClients(clients, 'player_chat', {
        globalIndex: nextChatIndex++,
        plainMessage: text,
        signedChatContent: '',
        unsignedChatContent: buildChatComponent(mcData, text),
        type: mcData.supportFeature('chatTypeIsHolder') ? { chatType: 1 } : 0,
        senderUuid: SERVER_UUID,
        senderName: JSON.stringify({ text: sender }),
        senderTeam: undefined,
        timestamp: Date.now(),
        salt: 0n,
        signature: mcData.supportFeature('useChatSessions') ? undefined : Buffer.alloc(0),
        previousMessages: [],
        filterType: 0,
        networkName: JSON.stringify({ text: sender })
      });
      return;
    }

    const legacyMessage = kind === 'chat'
      ? `<${sender}> ${text}`
      : `[${sender}] ${text}`;

    server.writeToClients(clients, 'chat', {
      message: JSON.stringify({ text: legacyMessage }),
      position: 0,
      sender: SERVER_UUID
    });
  }

  function broadcastSystemMessage(text, excludeClient = null) {
    sendMessage(connectedClients(excludeClient), text, 'Server', 'system');
  }

  function broadcastPlayerMessage(username, text) {
    sendMessage(connectedClients(), text, username, 'chat');
  }

  return {
    broadcastPlayerMessage,
    broadcastSystemMessage,
    sendMessage
  };
}

module.exports = {
  createChatApi,
  extractChatMessage,
  formatWelcomeMessage
};
