import amqplib from 'amqplib';

async function startAuditPointService(): Promise<void> {
  const connection = await amqplib.connect('amqp://localhost');
  const channel = await connection.createChannel();
  await channel.assertQueue('auditQueue');

  channel
    .consume('auditQueue', (msg: amqplib.Message | null) => {
      if (msg !== null) {
        console.log('Received:', msg.content.toString());
        // Handle the message processing
        // If it involves async operations, ensure to handle them properly
        channel.ack(msg);
      }
    })
    .catch((error) => {
      console.error('Consume error:', error);
    });
}

void startAuditPointService();
