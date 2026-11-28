/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as days from "../days.js";
import type * as functions from "../functions.js";
import type * as model_prayers from "../model/prayers.js";
import type * as model_reading from "../model/reading.js";
import type * as model_requests from "../model/requests.js";
import type * as overview from "../overview.js";
import type * as prayers from "../prayers.js";
import type * as reading from "../reading.js";
import type * as requests from "../requests.js";
import type * as shared_bible from "../shared/bible.js";
import type * as shared_recurrence from "../shared/recurrence.js";
import type * as shared_weeks from "../shared/weeks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  days: typeof days;
  functions: typeof functions;
  "model/prayers": typeof model_prayers;
  "model/reading": typeof model_reading;
  "model/requests": typeof model_requests;
  overview: typeof overview;
  prayers: typeof prayers;
  reading: typeof reading;
  requests: typeof requests;
  "shared/bible": typeof shared_bible;
  "shared/recurrence": typeof shared_recurrence;
  "shared/weeks": typeof shared_weeks;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
