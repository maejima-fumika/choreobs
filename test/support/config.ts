import type { ChoreoBSConfig } from "../../src/config/types.js";

/**
 * The endpoint sets the tests share.
 *
 * Almost every test needs one, and nine files used to declare their own — with
 * three different types for the same object.
 */
export const aliceBob: ChoreoBSConfig = { endpoints: ["alice", "bob"] };

export const aliceBobCarol: ChoreoBSConfig = {
  endpoints: ["alice", "bob", "carol"],
};
