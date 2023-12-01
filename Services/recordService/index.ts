import express, { type Request, type Response } from 'express';
import mqtt from 'mqtt';
import { v4 as uuidv4 } from 'uuid';
import * as http from 'http'; // Import the 'http' module

import { type Record, type User } from './types';
import { isValidRecord, isValidUser } from './validators';
import { populateFakeData } from './fakeData';

const app = express();
app.use(express.json());

const client = mqtt.connect('mqtt://localhost');

// Simulate a database for records
const recordsDb = populateFakeData();

// Temporary storage for records awaiting acknowledgment
const pendingRecords = new Map<string, Record>();

app.get('/health', (req, res) => {
  // Simulate a health issue randomly (for testing purposes)
  const isHealthy: number = 200;

  if (isHealthy === 200) {
    res.status(200).send({ status: 'healthy' });
  } else {
    const errorMessage = 'Health check failed';
    console.error(errorMessage);
    res.status(500).send({ status: 'unhealthy', error: errorMessage });
  }
});

// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/record', async (req: Request, res: Response) => {
  try {
    // Create an options object for the HTTP request
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
    };

    // Create an HTTP request
    const reqHttp = http.request(options, (healthResponse) => {
      if (healthResponse.statusCode !== 200) {
        // Health check failed, return an error response
        res.status(500).send({ message: 'Health check failed' });
        return;
      }

      if (!isValidRecord(req.body)) {
        res.status(400).send({ message: 'Invalid record format' });
      }
    });

    // Handle errors on the request
    reqHttp.on('error', (error) => {
      console.error('Error checking health:', error);
      res.status(500).send({ message: 'Failed to check health' });
    });

    // Send the request
    reqHttp.end();
  } catch (error) {
    console.error('Error checking health:', error);
    res.status(500).send({ message: 'Failed to check health' });
  }

  const recordData: Record = req.body;
  let operationType = '';

  // Simulate user data extraction
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const retryPublish = async () => {
    while (retries < maxRetries) {
      try {
        await publishMessage();
        retries++;
      } catch (error) {
        // Handle errors from publishMessage
        console.error('Error publishing message:', error);
      }

      // Sleep for retryInterval milliseconds before the next retry
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }

    // If max retries reached without success
    if (!responseSent) {
      clearInterval(retryPublishInterval);
      if (!res.headersSent) {
        // Only send a response if one hasn't been sent already
        res.status(500).send({ message: 'Failed to send record for auditing' });
      }
    }
  };

  // Initial publish
  try {
    await publishMessage();
  } catch (error) {
    // Handle errors from publishMessage
    console.error('Error publishing message:', error);
  }

  // Start the retry logic
  const retryPublishInterval = setInterval(retryPublish, retryInterval);

  let responseSent = false;

  // Acknowledgment listener
  client.subscribe(`ackQueue/${recordData.recordId}`, () => {
    client.on('message', (topic, buffer) => {
      if (topic === `ackQueue/${recordData.recordId}` && !responseSent) {
        // Check the flag
        responseSent = true; // Set the flag to true to prevent multiple responses
        clearInterval(retryPublishInterval); // Stop retrying on acknowledgment
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
    clearInterval(retryPublishInterval);
  });
});

const port = 3000;
app.listen(port, () => {
  console.log(`RecordService running on port ${port}`);
});
