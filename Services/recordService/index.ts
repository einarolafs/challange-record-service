import express, { type Request, type Response } from 'express';
import mqtt from 'mqtt';

const app = express();
app.use(express.json());

const client = mqtt.connect('mqtt://localhost');

// Simulated database
const recordsDb: Record<string, any> = {};

app.get('/health', (req: Request, res: Response) => {
  res.status(200).send({ status: 'healthy' });
});

app.post('/record', (req: Request, res: Response) => {
  const { recordData, orgUuid, userUuid } = req.body;
  const recordId = Date.now().toString();
  recordsDb[recordId] = recordData;

  const message = JSON.stringify({
    type: 'record-update',
    data: recordData,
    recordId,
    orgUuid,
    userUuid,
  });

  let retries = 0;
  const maxRetries = 5; // Maximum number of retries
  const retryInterval = 2000; // Retry every 2 seconds

  const sendMessage = (): void => {
    if (retries < maxRetries) {
      client.publish('auditQueue', message);
      retries++;
    } else {
      console.error(
        'AuditPoint Service is unavailable, failed to process record'
      );
      res.status(500).send({ message: 'Failed to process record' });
    }
  };

  client.publish('auditQueue', message);

  client.subscribe(`ackQueue/${recordId}`, () => {
    client.on('message', (topic, message) => {
      if (topic === `ackQueue/${recordId}`) {
        console.log('Record update finalized:', recordsDb[recordId]);
        res.status(200).send({ message: 'Record update finalized' });
        client.unsubscribe(`ackQueue/${recordId}`);
      }
    });
  });

  setInterval(sendMessage, retryInterval); // Retry sending the message at intervals
});

const port = 3000;
app.listen(port, () => {
  console.log(`RecordService running on port ${port}`);
});
