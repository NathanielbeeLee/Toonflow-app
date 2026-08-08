import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
const router = express.Router();

export default router.get("/", async (req, res) => {
  const data = await u.db("o_user").select("id", "name", "must_change_password as mustChangePassword").first();
  res.status(200).send(success(data));
});
