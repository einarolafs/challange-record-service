/* eslint-disable @typescript-eslint/no-misused-promises */
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

const recordsDb = populateFakeData();
const pendingRecords = new Map<string, Record>();

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

const sendErrorResponse = (
  res: Response,
  statusCode: number,
  message: string
): void => {
  if (!res.headersSent) {
    res.status(statusCode).send({ message });
  }
};

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

const handleRecordPost = async (req: Request, res: Response): Promise<void> => {
  try {
    let responseSent = false;

    const healthResponse = await sendHttpRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
    });

    if (healthResponse.statusCode !== 200) {
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

    let retries = 0;
    const maxRetries = 5;
    const retryInterval = 2000;

    const publishMessage = async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        client.publish('auditQueue', message, {}, (err) => {
          if (err != null) {
            console.error('Failed to publish message:', err);
            if (retries >= maxRetries) {
              sendErrorResponse(res, 500, 'Failed to send record for auditing');
              responseSent = true;
              reject(err);
            }
          } else {
            resolve();
          }
        });
      });
    };

    const retryPublish: () => Promise<void> = async () => {
      while (retries < maxRetries) {
        try {
          await publishMessage();
          retries++;
        } catch (error) {
          console.error('Error publishing message:', error);
        }

        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }

      if (!responseSent) {
        clearInterval(retryPublishInterval);
        if (!res.headersSent) {
          sendErrorResponse(res, 500, 'Failed to send record for auditing');
          responseSent = true;
        }
      }
    };

    try {
      await publishMessage();
    } catch (error) {
      console.error('Error publishing message:', error);
    }

    const retryPublishInterval = setInterval(retryPublish, retryInterval);

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

// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/health', handleHealthCheck);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/record', handleRecordPost);

const port = 3000;
app.listen(port, () => {
  console.log(`RecordService running on port ${port}`);
});
