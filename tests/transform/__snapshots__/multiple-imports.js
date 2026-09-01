import { __pw_import__ } from "virtual:playwright-stubs/runtime";
import { foo as __pw_0_foo, bar as __pw_1_bar } from './a'
const foo = __pw_import__({"specifier":"./a","moduleId":"src/demo/a.ts"}, "foo", __pw_0_foo);
const bar = __pw_import__({"specifier":"./a","moduleId":"src/demo/a.ts"}, "bar", __pw_1_bar);
import { baz as __pw_2_baz } from './b'
const baz = __pw_import__({"specifier":"./b","moduleId":"src/demo/b.ts"}, "baz", __pw_2_baz);
foo(); bar(); baz()
