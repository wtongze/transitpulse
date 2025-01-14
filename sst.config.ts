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

    const table = new sst.aws.Dynamo("Table", {
      fields: {
        id: "string",
        stopGeoHash: "string"
      },
      primaryIndex: {
        hashKey: "id"
      },
      globalIndexes: {
        StopGeoHashIndex: {
          hashKey: "stopGeoHash",
          rangeKey: "id"
        }
      }
    });

    new sst.aws.Function("Hono", {
      url: true,
      link: [table, scmtdKey, sfbay511Key],
      handler: "src/index.handler",
    });
  },
});
