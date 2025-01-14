import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';

import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

import Model from "./model";

import stopRouter from "./router/stop";
import predictionRouter from "./router/prediction";

const client = new DynamoDB({});
const ddbClient = DynamoDBDocument.from(client);
export const model = new Model(ddbClient);

const app = new Hono();

app.get('/', (c) => {
  return c.text('Hello from TransitPulse!');
});

app.route('/stop', stopRouter);
app.route('/prediction', predictionRouter);

export const handler = handle(app);
