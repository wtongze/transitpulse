import { Resource } from "sst";
import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as h3 from 'h3-js';
import AdmZip from 'adm-zip';
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { chunk } from 'lodash-es';
import Model from "./model";
import { config } from "./config";
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

app.post('/gtfs',
  zValidator(
    'form',
    z.object({
      name: z.string().nonempty(),
      gtfsFile: z.instanceof(File)
    })
  ),
  async (c) => {
    const { name, gtfsFile } = c.req.valid('form');
    const gtfsFileBuffer = Buffer.from(await gtfsFile.arrayBuffer());
    const gtfsZip = new AdmZip(gtfsFileBuffer);

    const rawStops = gtfsZip.readFile("stops.txt")!.toString('utf-8').split('\n');
    const stops = rawStops.slice(1, rawStops.length - 1).map(s => {
      const regex = /(".*?"|[^,]+)/g;
      const token = s.match(regex)!.map(i => i.replace(/^"|"$/g, ''));

      const lat = parseFloat(token[3]);
      const lon = parseFloat(token[4]);

      return {
        id: `${name}#stop#${token[0]}`,
        stopCode: token[1],
        stopName: token[2],
        stopLat: lat,
        stopLon: lon,
        stopGeoHash: h3.latLngToCell(lat, lon, config.H3_GEOHASH_RESOLUTION)
      };
    });
    const stopChunks = chunk(stops, 25);

    for (const chunk of stopChunks) {
      const putRequests = chunk.map((stop) => ({
        PutRequest: {
          Item: stop,
        },
      }));

      await ddbClient.batchWrite(
        {
          RequestItems: {
            [Resource.Table.name]: putRequests
          }
        }
      );
    }

    return c.json({ name, stops: stops.length });
  });

export const handler = handle(app);
