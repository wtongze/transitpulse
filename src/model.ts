import * as h3 from "h3-js";
import haversine from "haversine-distance";
import { Resource } from "sst/resource";
import { config } from "./config";
import type { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

export default class Model {
  ddbClient: DynamoDBDocument;

  constructor(ddbClient: DynamoDBDocument) {
    this.ddbClient = ddbClient;
  }

  async getStopByLatLon(lat: number, lon: number) {
    const index = h3.latLngToCell(lat, lon, config.H3_SEARCH_RESOLUTION);
    const childrenHash = h3.cellToChildren(index, config.H3_GEOHASH_RESOLUTION);

    const res = await Promise.all(childrenHash.map(async (h) => {
      const { Items: items } = await this.ddbClient.query(
        {
          TableName: Resource.Table.name,
          IndexName: "StopGeoHashIndex",
          KeyConditionExpression: 'stopGeoHash = :geoHash',
          ExpressionAttributeValues: {
            ':geoHash': h,
          },
        }
      );
      return items == undefined ? [] : items;
    }));

    const result = res.flat().sort((a, b) => {
      const distanceA = haversine({
        lat: a.stopLat,
        lon: a.stopLon,
      }, {
        lat,
        lon
      });
      const distanceB = haversine({
        lat: b.stopLat,
        lon: b.stopLon,
      }, {
        lat,
        lon
      });
      return distanceA - distanceB;
    });
    return result;
  }
}
