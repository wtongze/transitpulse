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
import { DateTime } from 'luxon';
import Model from "./model";
import { config } from "./config";

const client = new DynamoDB({});
const ddbClient = DynamoDBDocument.from(client);

const app = new Hono();
const model = new Model(ddbClient);

app.get('/', (c) => {
  return c.text('Hello Hono!');
});

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

app.get('/stop/by-location/:lat/:lon',
  zValidator(
    'param',
    z.object({
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180)
    })
  ),
  async (c) => {
    const { lat, lon } = c.req.valid('param');
    const stops = await model.getStopByLatLon(lat, lon);

    return c.json({
      lat,
      lon,
      stops: stops.slice(0, 4),
      scanCount: stops.length
    });
  }
);

app.get('/prediction/by-location/:lat/:lon',
  zValidator(
    'param',
    z.object({
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180)
    })
  ),
  async (c) => {
    const { lat, lon } = c.req.valid('param');
    const stops = await model.getStopByLatLon(lat, lon);
    const stopIds = stops.slice(0, 4).map(i => ({ provider: i.id.split("#")[0], stopCode: i.stopCode }));

    const scmtdStops = stopIds.filter(i => i.provider == "scmtd").map(i => i.stopCode);

    const res = await fetch(`https://rt.scmetro.org/bustime/api/v3/getpredictions?key=${Resource.ScmtdKey.value}&stpid=${scmtdStops.join(",")}&tmres=s&format=json`);
    const result = await res.json();
    const now = DateTime.now();

    const prediction = result['bustime-response']['prd'].map((i: any) => {
      const predTime = DateTime.fromFormat(i.prdtm, 'yyyyMMdd HH:mm:ss', {
        zone: 'America/Los_Angeles'
      });

      return {
        route: i.rt,
        routeDirection: i.rtdir,
        predictionTime: predTime.toString(),
        timeDiff: Math.floor(predTime.diff(now, "minute").minutes),
        stopId: i.stpid,
        stopName: i.stpnm
      };
    });

    return c.json({
      lat,
      lon,
      prediction
    });
  }
);

export const handler = handle(app);
