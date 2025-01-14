import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { DateTime } from "luxon";
import { Resource } from "sst";
import { z } from "zod";
import { model } from "..";

const predictionRouter = new Hono();

predictionRouter.get(
    '/by-location/:lat/:lon',
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

        const prediction = (result['bustime-response']['prd'] || []).map((i: any) => {
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

export default predictionRouter;
