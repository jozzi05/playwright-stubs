import { __pw_import__ } from "virtual:playwright-stubs/runtime";
import { foo, bar as __pw_0_bar } from './dependency'
const bar = __pw_import__({"specifier":"./dependency","moduleId":"src/demo/dependency.ts"}, "bar", __pw_0_bar);
export { foo }
bar()
