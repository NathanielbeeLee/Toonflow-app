import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { hashPassword } from "@/services/auth/password";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    name: z.string(),
    password: z.string().min(8).max(128),
    id: z.number(),
  }),
  async (req, res) => {
    const { name, password, id } = req.body;
    await (u.db as any)("o_user").where("id", id).update({
      name,
      password: await hashPassword(password),
      must_change_password: 0,
    });
    res.status(200).send(success("保存设置成功"));
  },
);
