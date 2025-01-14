import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import AdmZip from 'adm-zip';
import { Handler, S3Event } from 'aws-lambda';
import { Resource } from 'sst';
import * as h3 from 'h3-js';
import { chunk } from 'lodash-es';
import { config } from "../config";

export const handler: Handler<S3Event> = async (event) => {
    const client = new DynamoDB({});
    const ddbClient = DynamoDBDocument.from(client);

    for (const record of event.Records) {
        const fileKey = record.s3.object.key;
        const provider = fileKey.replace("gtfs/", "").replace(".zip", "");
        console.log(`Processing ${fileKey}...`);

        const client = new S3Client({});
        const response = await client.send(
            new GetObjectCommand({
                Bucket: Resource.GtfsBucket.name,
                Key: fileKey
            })
        );
        const fileByteArray = await response.Body!.transformToByteArray();
        const gtfsZip = new AdmZip(Buffer.from(fileByteArray));

        const rawStops = gtfsZip.readFile("stops.txt")!.toString('utf-8').split('\n');
        const header = rawStops[0].split(",");
        const latIdx = header.indexOf("stop_lat");
        const lonIdx = header.indexOf("stop_lon");

        const stops = rawStops.slice(1, rawStops.length - 1).map(s => {
            const regex = /(".*?"|[^,]+)/g;
            const token = s.match(regex)!.map(i => i.replace(/^"|"$/g, ''));

            const lat = parseFloat(token[latIdx]);
            const lon = parseFloat(token[lonIdx]);

            try {
                const geoHash = h3.latLngToCell(lat, lon, config.H3_GEOHASH_RESOLUTION);
                return {
                    id: `stop#${provider}#${token[0]}`,
                    stopCode: token[1] || "",
                    stopName: token[2] || "",
                    stopLat: lat,
                    stopLon: lon,
                    stopGeoHash: geoHash,
                    provider: provider
                };
            } catch {
                console.error(lat, lon, token);
            }
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
        console.log(`${stops.length} stops from ${provider} have been processed`);
    }

    return "ok";
};
