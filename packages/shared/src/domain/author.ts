import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { OutboundLinkSchema } from "./links";

/**
 * Who posted this, and where they sell.
 *
 * Attached to a card rather than folded into `source` because it is a different fact with
 * a different lifetime: a post is collected once, while a profile belongs to an account
 * and answers for every post that account appears in. Measured on the Style board, 76
 * posts came from 61 accounts.
 *
 * It exists at all because of what the board is for — "내가 좋아요한 옷 사진과 구매 경로를
 * 모아보는 것". Almost no saved post carries a link; the shop is in the poster's bio.
 */
export const AuthorRefSchema = z.object({
  /** As the platform spells it — `juuuyeonn`. */
  handle: z.string().min(1),
  /** The name shown above the bio — `주연`. Null when the account sets none, which is real. */
  displayName: z.string().nullable(),
  /**
   * Where the profile points, in the order it lists them, each labelled with the title its
   * owner gave it. Empty for an account that publishes none.
   */
  links: z.array(OutboundLinkSchema).default([]),
  /**
   * Accounts the bio names, as handles.
   *
   * Never rewritten into URLs: whether `@brand.official` is the shop, a collaborator or a
   * friend is not something a bio says, and turning it into a link would decide.
   */
  mentions: z.array(z.string()).default([]),
  /** When the profile was last read. Null means nobody has looked. */
  checkedAt: IsoDateTimeSchema.nullable(),
});

export type AuthorRef = z.infer<typeof AuthorRefSchema>;
