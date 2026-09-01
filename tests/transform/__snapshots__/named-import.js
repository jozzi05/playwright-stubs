import { __pw_import__ } from "virtual:playwright-stubs/runtime";
import { foo as __pw_0_foo } from './dependency'
const foo = __pw_import__({"specifier":"./dependency","moduleId":"src/demo/dependency.ts"}, "foo", __pw_0_foo);
console.log(foo(1))
