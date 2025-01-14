import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { model } from "..";
import { config } from "../config";

const stopRouter = new Hono();

stopRouter.get(
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

        return c.json({
            lat,
            lon,
            stops: stops.slice(0, config.MAX_STOPS_RETURNED),
            scanCount: stops.length
        });
    }
);

export default stopRouter;
