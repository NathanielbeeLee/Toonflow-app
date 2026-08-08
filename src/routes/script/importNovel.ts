import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { commitNovelImport, previewNovelImport } from "@/services/script-import/importNovel";

const router = express.Router();

const sourceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("json"), content: z.string().trim().min(2).max(25 * 1024 * 1024) }),
  z.object({
    mode: z.literal("api"),
    baseUrl: z.url(),
    novelId: z.string().trim().min(1).max(200),
    projectKind: z.enum(["novel", "drama"]).default("novel"),
    apiToken: z.string().max(10_000).optional(),
  }),
]);

router.post(
  "/preview",
  validateFields({ projectId: z.number().int().positive(), source: sourceSchema }),
  async (req, res) => {
    try {
      return res.status(200).send(success(await previewNovelImport(req.body)));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return res.status(400).send(error(message));
    }
  },
);

router.post(
  "/commit",
  validateFields({
    projectId: z.number().int().positive(),
    source: sourceSchema,
    chapterIds: z.array(z.string().trim().min(1)).min(1).max(5_000),
  }),
  async (req, res) => {
    try {
      return res.status(200).send(success(await commitNovelImport(req.body)));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return res.status(400).send(error(message));
    }
  },
);

export default router;
