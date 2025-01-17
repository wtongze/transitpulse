import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import AdmZip from 'adm-zip';
import { Handler, S3Event } from 'aws-lambda';
import { Resource } from 'sst';
import * as h3 from 'h3-js';
import { chunk } from 'lodash-es';
import { config } from "../config";
import { parse } from 'csv-parse/sync';

const dbClient = new DynamoDB({});
const ddbClient = DynamoDBDocument.from(dbClient);
const s3Client = new S3Client({});

export const handler: Handler<S3Event> = async (event) => {
    for (const record of event.Records) {
        const fileKey = record.s3.object.key;
        const provider = fileKey.replace("gtfs/", "").replace(".zip", "");

        console.log(`Processing ${fileKey}...`);

        await deleteByProvider(provider);

        const response = await s3Client.send(
            new GetObjectCommand({
                Bucket: Resource.GtfsBucket.name,
                Key: fileKey
            })
        );
        const fileByteArray = await response.Body!.transformToByteArray();
        const gtfsZip = new AdmZip(Buffer.from(fileByteArray));

        const rawStops = gtfsZip.readFile("stops.txt")!.toString('utf-8');
        const stopItems = parse(rawStops, {
            columns: true,
            skip_empty_lines: true
        }) as Stop[];

        const stops = stopItems
            .map(i => {
                if (i.stop_lat && i.stop_lon && i.stop_code && i.stop_name) {
                    const lat = parseFloat(i.stop_lat);
                    const lon = parseFloat(i.stop_lon);
                    const geoHash = h3.latLngToCell(lat, lon, config.H3_GEOHASH_RESOLUTION);

                    return {
                        id: `stop#${provider}#${i.stop_id}`,
                        stopCode: i.stop_code,
                        stopName: i.stop_name,
                        stopLat: lat,
                        stopLon: lon,
                        stopGeoHash: geoHash,
                        provider: provider
                    };
                } else {
                    return undefined;
                }
            })
            .filter(i => i);

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

async function deleteByProvider(provider: string) {
    const results = ((await ddbClient.query({
        TableName: Resource.Table.name,
        IndexName: "ProviderIndex",
        KeyConditionExpression: "provider = :provider",
        ExpressionAttributeValues: {
            ":provider": provider
        },
        ProjectionExpression: "id"
    })).Items || []).map(i => i.id);
    
    const keyChunk = chunk(results, 25);
    for (const chunk of keyChunk) {
        const deleteRequests = chunk.map((k) => ({
            DeleteRequest: {
                Key: {
                    id: k
                }
            },
        }));

        await ddbClient.batchWrite(
            {
                RequestItems: {
                    [Resource.Table.name]: deleteRequests
                }
            }
        );
    }
    console.log(`${results.length} entries from ${provider} have been removed`);
}

