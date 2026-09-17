import { Router, type IRouter } from "express";
import healthRouter from "./health";
import seolyticRouter from "./seolytic";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(seolyticRouter);

export default router;
