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

/**
 * `aliceBob` in strict mode (spec §strict-mode): an omitted location
 * that nothing infers is an error instead of `@dyn`. For the tests of those
 * errors, which the default mode no longer reports in choreography code.
 */
export const aliceBobStrict: ChoreoBSConfig = {
  endpoints: ["alice", "bob"],
  implicitDyn: false,
};
