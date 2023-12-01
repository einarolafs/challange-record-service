import express from 'express';
import type { Request, Response } from 'express';
import amqplib from 'amqplib';

const app = express();
app.use(express.json());

const asyncHandler =
  (
    fn: (
      req: Request,
      res: Response,
      next: express.NextFunction
    ) => Promise<void>
  ) =>
  (req: Request, res: Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

app.post(
  '/record',
  asyncHandler(async (req: Request, res: Response) => {
    const recordData = req.body;
    try {
      const connection = await amqplib.connect('amqp://localhost');
      const channel = await connection.createChannel();
      const msg = JSON.stringify({ type: 'record-update', data: recordData });
      await channel.assertQueue('auditQueue');
      channel.sendToQueue('auditQueue', Buffer.from(msg));
      res.status(200).send({ message: 'Record updated' });
    } catch (error) {
      // Handle error appropriately
      console.error(error);
      res.status(500).send({ message: 'Error processing request' });
    }
  })
);

const port = 3000;
app.listen(port, () => {
  console.log(`RecordService running on port ${port}`);
});
