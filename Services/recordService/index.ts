import express, { type Request, type Response } from 'express';
import mqtt from 'mqtt';
import { v4 as uuidv4 } from 'uuid';

import { type Record, type User } from './types'; // Assuming these are defined in types.ts
import { isValidRecord, isValidUser } from './validators'; // Assuming these are defined in validators.ts
import { populateFakeData } from './fakeData'; // Assuming this provides initial data

const app = express();
app.use(express.json());

const client = mqtt.connect('mqtt://localhost');

// Using Map to simulate a database for records
const recordsDb = populateFakeData();

// Temporary storage for records awaiting acknowledgment
const pendingRecords = new Map<string, Record>();

app.get('/health', (req, res) => {
  // Simulate a health issue randomly (for testing purposes)
  const isHealthy: number = 200; // Adjust the probability as needed

  if (isHealthy === 200) {
    res.status(200).send({ status: 'healthy' });
  } else {
    // Simulate a health issue by throwing an error
    const errorMessage = 'Health check failed';
    console.error(errorMessage);
    res.status(500).send({ status: 'unhealthy', error: errorMessage });
  }
});

// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/record', async (req: Request, res: Response) => {
  // Wrap the entire handler in an async function
  try {
    // Check the health of the /health endpoint
    const healthResponse = await fetch('http://localhost:3000/health');
    if (healthResponse.status !== 200) {
      // Health check failed, return an error response
      return res.status(500).send({ message: 'Health check failed' });
    }

    if (!isValidRecord(req.body)) {
      return res.status(400).send({ message: 'Invalid record format' });
    }
  } catch (error) {
    console.error('Error checking health:', error);
    return res.status(500).send({ message: 'Failed to check health' });
  }

  const recordData: Record = req.body;
  let operationType = '';

  // Simulate user data extraction, here assuming the request body includes user info
  const userData: User = {
    userId: recordData.userId,
    name: '', // This should be provided in the request or fetched from a user service
    org: recordData.org,
  };

  if (!isValidUser(userData)) {
    return res.status(400).send({ message: 'Invalid user format' });
  }

  let recordId: string;
  if (recordData.recordId != null) {
    // Update scenario
    if (!recordsDb.has(recordData.recordId)) {
      return res.status(404).send({ message: 'Record not found for update' });
    }
    recordId = recordData.recordId;
    operationType = 'updated';
  } else {
    // Create scenario
    recordId = uuidv4(); // Generate new ID for creation
    recordData.recordId = recordId;
    operationType = 'created';
  }

  // Store the record in the pendingRecords
  pendingRecords.set(recordId, recordData);

  const message = JSON.stringify({
    ...recordData,
    recordId,
  });

  let retries = 0;
  const maxRetries = 5;
  const retryInterval = 2000; // milliseconds

  const publishMessage = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      client.publish('auditQueue', message, {}, (err) => {
        if (err != null) {
          console.error('Failed to publish message:', err);
          if (retries >= maxRetries) {
            res
              .status(500)
              .send({ message: 'Failed to send record for auditing' });
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });
  };

  // Retry logic
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const retryPublish = setInterval(async () => {
    if (retries >= maxRetries) {
      clearInterval(retryPublish);
      if (!res.headersSent) {
        // Only send a response if one hasn't been sent already
        res.status(500).send({
          message:
            'AuditPoint Service is unavailable, failed to process record',
        });
      }
      return;
    }
    try {
      await publishMessage();
      retries++;
    } catch (error) {
      // Handle errors from publishMessage
      console.error('Error publishing message:', error);
      if (retries >= maxRetries) {
        clearInterval(retryPublish);
        if (!res.headersSent) {
          res.status(500).send({
            message: 'Failed to send record for auditing',
          });
        }
      }
    }
  }, retryInterval);

  // Initial publish
  try {
    await publishMessage();
  } catch (error) {
    // Handle errors from publishMessage
    console.error('Error publishing message:', error);
    if (retries >= maxRetries) {
      clearInterval(retryPublish);
      if (!res.headersSent) {
        res.status(500).send({
          message: 'Failed to send record for auditing',
        });
      }
    }
  }

  let responseSent = false;

  // Acknowledgment listener
  client.subscribe(`ackQueue/${recordData.recordId}`, () => {
    client.on('message', (topic, buffer) => {
      if (topic === `ackQueue/${recordData.recordId}` && !responseSent) {
        // Check the flag
        responseSent = true; // Set the flag to true to prevent multiple responses
        clearInterval(retryPublish); // Stop retrying on acknowledgment
        const pendingRecord = pendingRecords.get(recordId);
        if (pendingRecord != null) {
          recordsDb.set(recordId, pendingRecord);
          pendingRecords.delete(recordId);
          console.log(
            `Record ${recordData.recordId} processed and ${operationType}.`
          );
          res.status(200).send({
            message: `Record successfully ${operationType} with id ${recordData.recordId}`,
          });
        }
        client.unsubscribe(`ackQueue/${recordData.recordId}`);
      }
    });
  });

  // Clear interval on response end to prevent memory leaks
  res.on('finish', () => {
    clearInterval(retryPublish);
  });
});

const port = 3000;
app.listen(port, () => {
  console.log(`RecordService running on port ${port}`);
});
