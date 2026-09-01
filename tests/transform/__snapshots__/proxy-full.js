import { __pw_module__ } from "virtual:playwright-stubs/runtime";
import * as __pw$real from "/repo/src/demo/api.ts";
export * from "/repo/src/demo/api.ts";
var __pw$m = __pw_module__({"id":"src/demo/api.ts","specifiers":["./api"],"exportNames":["getUser","helper","default"]}, __pw$real);
export function getUser(...__pw$args) {
  if (__pw$m !== undefined) return __pw$m.call("getUser", this, __pw$args, new.target);
  return new.target !== undefined
    ? Reflect.construct(__pw$real["getUser"], __pw$args, new.target)
    : Reflect.apply(__pw$real["getUser"], this, __pw$args);
}
export const helper = __pw$m.wrap("helper");
const __pw$default = __pw$m.wrap("default");
export default __pw$default;
