import express, { type Request, type Response } from 'express';
import mqtt from 'mqtt';

const app = express();
app.use(express.json());

const client = mqtt.connect('mqtt://localhost');

// Using Map to store records
const recordsDb = new Map<string, any>();

app.get('/health', (req: Request, res: Response) => {
  res.status(200).send({ status: 'healthy' });
});

app.post('/record', (req: Request, res: Response) => {
  const { recordData, orgUuid, userUuid } = req.body;
  const recordId = Date.now().toString();

  // Store record in the Map
  recordsDb.set(recordId, recordData);

  const message = JSON.stringify({
    type: 'record-update',
    data: recordData,
    recordId,
    orgUuid,
    userUuid,
  });

  let retries = 0;
  const maxRetries = 5;
  const retryInterval = 2000;
  let responseSent = false;

  const sendMessage = (): void => {
    if (responseSent) return;

    if (retries < maxRetries) {
      client.publish('auditQueue', message);
      retries++;
    } else {
      console.error(
        'AuditPoint Service is unavailable, failed to process record'
      );
      res.status(500).send({ message: 'Failed to process record' });
      responseSent = true;
    }
  };

  client.publish('auditQueue', message);

  client.subscribe(`ackQueue/${recordId}`, () => {
    client.on('message', (topic, message) => {
      if (responseSent) return;

      if (topic === `ackQueue/${recordId}`) {
        console.log('Record update finalized:', recordsDb.get(recordId));
        res.status(200).send({ message: 'Record update finalized' });
        client.unsubscribe(`ackQueue/${recordId}`);
        responseSent = true;
      }
    });
  });

  const retryIntervalId = setInterval(sendMessage, retryInterval);

  // Clear interval and prevent further retries after a response is sent
  res.on('finish', () => {
    clearInterval(retryIntervalId);
    responseSent = true;
  });
});

const port = 3000;
app.listen(port, () => {
  console.log(`RecordService running on port ${port}`);
});
