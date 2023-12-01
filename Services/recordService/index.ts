import express, { type Request, type Response } from 'express';
import mqtt from 'mqtt';
import { v4 as uuidv4 } from 'uuid';
import * as http from 'http';

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

// Abstracted HTTP request function
const sendHttpRequest = async (
  options: http.RequestOptions
): Promise<http.IncomingMessage> => {
  return await new Promise((resolve, reject) => {
    const reqHttp = http.request(options, (res) => {
      resolve(res);
    });

    reqHttp.on('error', (error) => {
      reject(error);
    });

    reqHttp.end();
  });
};

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
  let responseSent = false; // Flag to track if a response has been sent
  try {
    // Send the health check request using the abstracted function
    const healthResponse = await sendHttpRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
    });

    if (healthResponse.statusCode !== 200) {
      // Health check failed, return an error response
      res.status(500).send({ message: 'Health check failed' });
      responseSent = true; // Set the flag to true
      return;
    }

    const recordData: Record = req.body;
    let operationType = '';

    if (!isValidRecord(recordData)) {
      // Invalid record format, return an error response
      res.status(400).send({ message: 'Invalid record format' });
      return;
    }

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
    const retryPublish: () => Promise<void> = async () => {
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
          res
            .status(500)
            .send({ message: 'Failed to send record for auditing' });
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
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const retryPublishInterval = setInterval(retryPublish, retryInterval);

    // Acknowledgment listener
    client.subscribe(`ackQueue/${recordData.recordId}`, () => {
      client.on('message', (topic, buffer) => {
        if (topic === `ackQueue/${recordData.recordId}`) {
          // Check the flag
          if (!responseSent) {
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
        }
      });
    });

    // Clear interval on response end to prevent memory leaks
    res.on('finish', () => {
      clearInterval(retryPublishInterval);
    });
  } catch (error) {
    // Handle errors here
    console.error('Error processing record:', error);
    if (!responseSent) {
      res.status(500).send({ message: 'Failed to process record' });
    }
  }
});

const port = 3000;
app.listen(port, () => {
  console.log(`RecordService running on port ${port}`);
});
