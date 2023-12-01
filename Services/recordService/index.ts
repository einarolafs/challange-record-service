/* eslint-disable @typescript-eslint/no-misused-promises */
import express, { type Request, type Response } from 'express';
import mqtt from 'mqtt';
import { v4 as uuidv4 } from 'uuid';
import * as http from 'http';

import { type Record, type User } from './types';
import { isValidRecord, isValidUser } from './validators';
import { populateFakeData } from './fakeData';

// Create an Express application
const app = express();
app.use(express.json());

// Connect to the MQTT broker
const client = mqtt.connect('mqtt://localhost');

// Simulated database for records
const recordsDb = populateFakeData();

// Temporary storage for records awaiting acknowledgment
const pendingRecords = new Map<string, Record>();

// Function to send an HTTP request and return the response
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

// Function to send an error response if headers are not already sent
const sendErrorResponse = (
  res: Response,
  statusCode: number,
  message: string
): void => {
  if (!res.headersSent) {
    res.status(statusCode).send({ message });
  }
};

// Function to perform a health check
const sendHealthCheckRequest = async (): Promise<boolean> => {
  try {
    const healthResponse = await sendHttpRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
    });

    return healthResponse.statusCode === 200;
  } catch (error) {
    return false;
  }
};

// Function to publish a message to the audit queue
const publishMessage = async (message: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    client.publish('auditQueue', message, {}, (err) => {
      if (err != null) {
        console.error('Failed to publish message:', err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

// Function to handle the retry logic for publishing a message
const retryPublish = async (
  res: Response,
  recordData: Record,
  operationType: string,
  retries: number,
  maxRetries: number,
  retryInterval: number,
  message: string // Added message parameter here
): Promise<void> => {
  while (retries < maxRetries) {
    try {
      await publishMessage(message); // Pass the message parameter here
      retries++;
    } catch (error) {
      console.error('Error publishing message:', error);
    }

    await new Promise((resolve) => setTimeout(resolve, retryInterval));
  }

  if (!res.headersSent) {
    sendErrorResponse(res, 500, 'Failed to send record for auditing');
  }
};

// Route handler for health check
const handleHealthCheck = async (
  req: Request,
  res: Response
): Promise<void> => {
  const isHealthy = 200;

  if (isHealthy === 200) {
    res.status(200).send({ status: 'healthy' });
  } else {
    const errorMessage = 'Health check failed';
    console.error(errorMessage);
    sendErrorResponse(res, 500, errorMessage);
  }
};

// Route handler for creating or updating a record
const handleRecordPost = async (req: Request, res: Response): Promise<void> => {
  try {
    let responseSent = false;

    const healthCheckPassed = await sendHealthCheckRequest();

    if (!healthCheckPassed) {
      sendErrorResponse(res, 500, 'Health check failed');
      responseSent = true;
      return;
    }

    const recordData: Record = req.body;
    let operationType = '';

    if (!isValidRecord(recordData)) {
      sendErrorResponse(res, 400, 'Invalid record format');
      responseSent = true;
      return;
    }

    const userData: User = {
      userId: recordData.userId,
      name: '', // This should be provided in the request or fetched from a user service
      org: recordData.org,
    };

    if (!isValidUser(userData)) {
      sendErrorResponse(res, 400, 'Invalid user format');
      return;
    }

    let recordId: string;
    if (recordData.recordId != null) {
      if (!recordsDb.has(recordData.recordId)) {
        sendErrorResponse(res, 404, 'Record not found for update');
        return;
      }
      recordId = recordData.recordId;
      operationType = 'updated';
    } else {
      recordId = uuidv4();
      recordData.recordId = recordId;
      operationType = 'created';
    }

    pendingRecords.set(recordId, recordData);

    const message = JSON.stringify({
      ...recordData,
      recordId,
    });

    const retries = 0;
    const maxRetries = 5;
    const retryInterval = 2000;

    const retryPublishInterval = setInterval(async () => {
      await retryPublish(
        res,
        recordData,
        operationType,
        retries,
        maxRetries,
        retryInterval,
        message // Pass the message parameter here
      );
    }, retryInterval);

    client.subscribe(`ackQueue/${recordData.recordId}`, () => {
      client.on('message', (topic, buffer) => {
        if (topic === `ackQueue/${recordData.recordId}` && !responseSent) {
          responseSent = true;
          clearInterval(retryPublishInterval);
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

    res.on('finish', () => {
      clearInterval(retryPublishInterval);
    });
  } catch (error) {
    console.error('Error processing record:', error);
    if (!res.headersSent) {
      sendErrorResponse(res, 500, 'Failed to process record');
    }
  }
};

// Define routes
app.get('/health', handleHealthCheck);
app.post('/record', handleRecordPost);

// Start the Express server on port 3000
const port = 3000;
app.listen(port, () => {
  console.log(`RecordService running on port ${port}`);
});
