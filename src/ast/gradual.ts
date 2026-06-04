import type { Location } from "./location.js";

/**
 * A use-site gradual coercion recorded by the type checker on a typed
 * expression (spec §18.9–§18.17). It describes how an expression's result must
 * be adapted to the location expected at its use site. Dynamic operator, array,
 * and literal lowering is derived from located types during lowering and is not
 * represented here.
 */
export type GradualCoercion =
  | { readonly kind: "pack" }
  | { readonly kind: "requireScalar"; readonly at: Location }
  | { readonly kind: "requireArray"; readonly at: Location }
  | { readonly kind: "requireCondition" }
  | { readonly kind: "copyWrapper" };
