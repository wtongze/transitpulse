/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "transitpulse",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    const scmtdKey = new sst.Secret("ScmtdKey");
    const sfbay511Key = new sst.Secret("Sfbay511Key");

    const bucket = new sst.aws.Bucket("GtfsBucket");
    const table = new sst.aws.Dynamo("Table", {
      fields: {
        id: "string",
        stopGeoHash: "string",
        provider: "string"
      },
      primaryIndex: {
        hashKey: "id"
      },
      globalIndexes: {
        StopGeoHashIndex: {
          hashKey: "stopGeoHash",
          rangeKey: "id"
        },
        ProviderIndex: {
          hashKey: "provider"
        }
      }
    });

    const gtfsBucketCreatedHandler = new sst.aws.Function("GtfsBucketHandler", {
      link: [bucket, table],
      handler: "src/handler/gtfsBucketOnCreated.handler",
    });

    bucket.notify({
      notifications: [
        {
          name: "GtfsBucketOnCreated",
          function: gtfsBucketCreatedHandler.arn,
          events: ["s3:ObjectCreated:*"],
          filterSuffix: ".zip",
          filterPrefix: "gtfs/",
        }
      ],
    });

    new sst.aws.Function("Hono", {
      url: true,
      link: [table, scmtdKey, sfbay511Key, bucket],
      handler: "src/index.handler",
    });
  },
});
