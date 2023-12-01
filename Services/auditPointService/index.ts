import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://localhost');

client.on('connect', () => {
  console.log('AuditPointService connected to MQTT broker.');
  client.subscribe('auditQueue');
});

client.on('message', (topic, message) => {
  if (topic === 'auditQueue') {
    console.log('AuditPointService received a message:', message.toString());
    // Process the audit message here
    const parsedMessage = JSON.parse(message.toString());
    // ... processing logic ...

    // Once processed, publish an acknowledgment
    client.publish(`ackQueue/${parsedMessage.recordId}`, 'Acknowledgment');
  }
});

console.log('AuditPointService is running and waiting for messages...');
