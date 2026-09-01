import { __pw_import__ } from "virtual:playwright-stubs/runtime";
import def, { foo as __pw_0_foo } from './dependency'
const foo = __pw_import__({"specifier":"./dependency","moduleId":"src/demo/dependency.ts"}, "foo", __pw_0_foo);
def(); foo()
