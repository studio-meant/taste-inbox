import { z } from "zod";
import { ItemBoardSchema, ItemDetailModelSchema } from "./item-detail";

const ManualWebUrlSchema = z
  .string()
  .trim()
  .pipe(z.url().max(2048))
  .refine((value) => {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  }, "http 또는 https 웹 링크를 입력해 주세요.");

/** A user-authored bookmark. The service stores these fields and never fetches the URL. */
export const ManualItemCreateRequestSchema = z.object({
  url: ManualWebUrlSchema,
  board: ItemBoardSchema,
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().max(5000).optional(),
});

export const ManualItemCreateResponseSchema = z.object({
  created: z.boolean(),
  item: ItemDetailModelSchema,
});

export type ManualItemCreateRequest = z.infer<typeof ManualItemCreateRequestSchema>;
export type ManualItemCreateResponse = z.infer<typeof ManualItemCreateResponseSchema>;
